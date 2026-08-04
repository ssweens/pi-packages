import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PermissionDeniedError, PermissionPromptUnavailableError } from "../errors.js";
import { promptForPermission } from "../permission-prompt.js";
import { buildSpawnCommandOptions, buildTerminalShellSpawnCommand, buildTerminalSpawnCommand, } from "../spawn-command-options.js";
const DEFAULT_TERMINAL_OUTPUT_LIMIT_BYTES = 64 * 1024;
const DEFAULT_KILL_GRACE_MS = 1_500;
function nowIso() {
    return new Date().toISOString();
}
function toCommandLine(command, args) {
    const renderedArgs = (args ?? []).map((arg) => JSON.stringify(arg)).join(" ");
    return renderedArgs.length > 0 ? `${command} ${renderedArgs}` : command;
}
function toEnvObject(env) {
    if (!env || env.length === 0) {
        return undefined;
    }
    const merged = { ...process.env };
    for (const entry of env) {
        merged[entry.name] = entry.value;
    }
    return merged;
}
export function buildTerminalSpawnOptions(command, cwd, env, platform = process.platform) {
    const resolvedEnv = toEnvObject(env);
    const options = {
        cwd,
        env: resolvedEnv,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
    };
    return buildSpawnCommandOptions(command, options, platform, resolvedEnv ?? process.env);
}
function trimToUtf8Boundary(buffer, limit) {
    if (limit <= 0) {
        return Buffer.alloc(0);
    }
    if (buffer.length <= limit) {
        return buffer;
    }
    let start = buffer.length - limit;
    while (start < buffer.length && (buffer[start] & 0b1100_0000) === 0b1000_0000) {
        start += 1;
    }
    if (start >= buffer.length) {
        start = buffer.length - limit;
    }
    return buffer.subarray(start);
}
function waitForSpawn(process) {
    return new Promise((resolve, reject) => {
        const onSpawn = () => {
            process.off("error", onError);
            resolve();
        };
        const onError = (error) => {
            process.off("spawn", onSpawn);
            reject(error);
        };
        process.once("spawn", onSpawn);
        process.once("error", onError);
    });
}
async function defaultConfirmExecute(commandLine) {
    return await promptForPermission({
        prompt: `\n[permission] Allow terminal command "${commandLine}"? (y/N) `,
    });
}
function canPromptForPermission() {
    return process.stdin.isTTY && process.stderr.isTTY;
}
function waitMs(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, Math.max(0, ms));
    });
}
export class TerminalManager {
    cwd;
    permissionMode;
    nonInteractivePermissions;
    onOperation;
    usesDefaultConfirmExecute;
    confirmExecute;
    killGraceMs;
    terminals = new Map();
    constructor(options) {
        this.cwd = options.cwd;
        this.permissionMode = options.permissionMode;
        this.nonInteractivePermissions = options.nonInteractivePermissions ?? "deny";
        this.onOperation = options.onOperation;
        this.usesDefaultConfirmExecute = options.confirmExecute == null;
        this.confirmExecute = options.confirmExecute ?? defaultConfirmExecute;
        this.killGraceMs = Math.max(0, Math.round(options.killGraceMs ?? DEFAULT_KILL_GRACE_MS));
    }
    updatePermissionPolicy(permissionMode, nonInteractivePermissions) {
        this.permissionMode = permissionMode;
        this.nonInteractivePermissions = nonInteractivePermissions ?? "deny";
    }
    async createTerminal(params) {
        const commandLine = toCommandLine(params.command, params.args);
        const summary = `terminal/create: ${commandLine}`;
        this.emitOperation({
            method: "terminal/create",
            status: "running",
            summary,
            timestamp: nowIso(),
        });
        try {
            if (!(await this.isExecuteApproved(commandLine))) {
                throw new PermissionDeniedError("Permission denied for terminal/create");
            }
            const outputByteLimit = Math.max(0, Math.round(params.outputByteLimit ?? DEFAULT_TERMINAL_OUTPUT_LIMIT_BYTES));
            const { proc, spawnCommand } = await spawnTerminalProcess(params, this.cwd);
            let resolveExit = () => { };
            const exitPromise = new Promise((resolve) => {
                resolveExit = resolve;
            });
            const terminal = {
                process: proc,
                killProcessGroup: spawnCommand.killProcessGroup,
                descendantPids: new Set(),
                output: Buffer.alloc(0),
                truncated: false,
                outputByteLimit,
                exitCode: undefined,
                signal: undefined,
                exitPromise,
                resolveExit,
            };
            const appendOutput = (chunk) => {
                const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                if (bytes.length === 0) {
                    return;
                }
                terminal.output = Buffer.concat([terminal.output, bytes]);
                if (terminal.output.length > terminal.outputByteLimit) {
                    terminal.output = trimToUtf8Boundary(terminal.output, terminal.outputByteLimit);
                    terminal.truncated = true;
                }
            };
            proc.stdout.on("data", appendOutput);
            proc.stderr.on("data", appendOutput);
            proc.once("exit", (exitCode, signal) => {
                terminal.exitCode = exitCode;
                terminal.signal = signal;
                terminal.processGroupSnapshotPromise = rememberProcessGroupPids(terminal);
                void (async () => {
                    await terminal.processGroupSnapshotPromise;
                    terminal.resolveExit({
                        exitCode: exitCode ?? null,
                        signal: signal ?? null,
                    });
                })();
            });
            const terminalId = randomUUID();
            this.terminals.set(terminalId, terminal);
            this.emitOperation({
                method: "terminal/create",
                status: "completed",
                summary,
                details: `terminalId=${terminalId}`,
                timestamp: nowIso(),
            });
            return { terminalId };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.emitOperation({
                method: "terminal/create",
                status: "failed",
                summary,
                details: message,
                timestamp: nowIso(),
            });
            throw error;
        }
    }
    async terminalOutput(params) {
        const terminal = this.getTerminal(params.terminalId);
        if (!terminal) {
            throw new Error(`Unknown terminal: ${params.terminalId}`);
        }
        const hasExitStatus = terminal.exitCode !== undefined || terminal.signal !== undefined;
        this.emitOperation({
            method: "terminal/output",
            status: "completed",
            summary: `terminal/output: ${params.terminalId}`,
            timestamp: nowIso(),
        });
        return {
            output: terminal.output.toString("utf8"),
            truncated: terminal.truncated,
            exitStatus: hasExitStatus
                ? {
                    exitCode: terminal.exitCode ?? null,
                    signal: terminal.signal ?? null,
                }
                : undefined,
        };
    }
    async waitForTerminalExit(params) {
        const terminal = this.getTerminal(params.terminalId);
        if (!terminal) {
            throw new Error(`Unknown terminal: ${params.terminalId}`);
        }
        const response = await terminal.exitPromise;
        this.emitOperation({
            method: "terminal/wait_for_exit",
            status: "completed",
            summary: `terminal/wait_for_exit: ${params.terminalId}`,
            details: `exitCode=${response.exitCode ?? "null"}, signal=${response.signal ?? "null"}`,
            timestamp: nowIso(),
        });
        return response;
    }
    async killTerminal(params) {
        const terminal = this.getTerminal(params.terminalId);
        if (!terminal) {
            throw new Error(`Unknown terminal: ${params.terminalId}`);
        }
        const summary = `terminal/kill: ${params.terminalId}`;
        this.emitOperation({
            method: "terminal/kill",
            status: "running",
            summary,
            timestamp: nowIso(),
        });
        try {
            await this.killProcess(terminal);
            this.emitOperation({
                method: "terminal/kill",
                status: "completed",
                summary,
                timestamp: nowIso(),
            });
            return {};
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.emitOperation({
                method: "terminal/kill",
                status: "failed",
                summary,
                details: message,
                timestamp: nowIso(),
            });
            throw error;
        }
    }
    async releaseTerminal(params) {
        const summary = `terminal/release: ${params.terminalId}`;
        this.emitOperation({
            method: "terminal/release",
            status: "running",
            summary,
            timestamp: nowIso(),
        });
        const terminal = this.getTerminal(params.terminalId);
        if (!terminal) {
            this.emitOperation({
                method: "terminal/release",
                status: "completed",
                summary,
                details: "already released",
                timestamp: nowIso(),
            });
            return {};
        }
        try {
            await this.killProcess(terminal);
            await terminal.exitPromise.catch(() => {
                // ignore best-effort wait failures
            });
            terminal.output = Buffer.alloc(0);
            this.terminals.delete(params.terminalId);
            this.emitOperation({
                method: "terminal/release",
                status: "completed",
                summary,
                timestamp: nowIso(),
            });
            return {};
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.emitOperation({
                method: "terminal/release",
                status: "failed",
                summary,
                details: message,
                timestamp: nowIso(),
            });
            throw error;
        }
    }
    async shutdown() {
        for (const terminalId of Array.from(this.terminals.keys())) {
            await this.releaseTerminal({ terminalId, sessionId: "shutdown" });
        }
    }
    getTerminal(terminalId) {
        return this.terminals.get(terminalId);
    }
    emitOperation(operation) {
        this.onOperation?.(operation);
    }
    async isExecuteApproved(commandLine) {
        if (this.permissionMode === "approve-all") {
            return true;
        }
        if (this.permissionMode === "deny-all") {
            return false;
        }
        if (this.usesDefaultConfirmExecute &&
            this.nonInteractivePermissions === "fail" &&
            !canPromptForPermission()) {
            throw new PermissionPromptUnavailableError();
        }
        return await this.confirmExecute(commandLine);
    }
    isRunning(terminal) {
        return terminal.exitCode === undefined && terminal.signal === undefined;
    }
    async killProcess(terminal) {
        if (!this.isRunning(terminal) && !terminal.killProcessGroup) {
            return;
        }
        try {
            await this.signalProcess(terminal, "SIGTERM");
        }
        catch {
            return;
        }
        const exitedAfterTerm = await this.waitForCleanupAfterSignal(terminal);
        if (exitedAfterTerm && !terminal.killProcessGroup) {
            return;
        }
        try {
            await this.signalProcess(terminal, "SIGKILL");
        }
        catch {
            return;
        }
        await this.waitForCleanupAfterSignal(terminal);
    }
    async signalProcess(terminal, signal) {
        const pid = terminal.process.pid;
        if (terminal.killProcessGroup && pid && process.platform === "win32") {
            await this.signalWindowsProcessGroup(terminal, pid, signal);
            return;
        }
        if (terminal.killProcessGroup && pid) {
            await this.signalPosixProcessGroup(terminal, pid, signal);
            return;
        }
        terminal.process.kill(signal);
    }
    async signalWindowsProcessGroup(terminal, pid, signal) {
        await this.captureDescendantPids(terminal, pid);
        if (this.isRunning(terminal)) {
            await killWindowsProcessTree(pid, signal);
            return;
        }
        for (const descendantPid of terminal.descendantPids) {
            await killWindowsProcessTree(descendantPid, signal);
        }
    }
    async signalPosixProcessGroup(terminal, pid, signal) {
        await this.captureDescendantPids(terminal, pid);
        if (hasLiveProcessGroup(pid)) {
            sendSignal(-pid, signal);
            return;
        }
        for (const descendantPid of terminal.descendantPids) {
            sendSignal(descendantPid, signal);
        }
    }
    async captureDescendantPids(terminal, pid) {
        if (!this.isRunning(terminal)) {
            await terminal.processGroupSnapshotPromise?.catch(() => {
                // ignore best-effort process group snapshot failures
            });
        }
        for (const descendantPid of await listDescendantPids(pid)) {
            terminal.descendantPids.add(descendantPid);
        }
    }
    async waitForCleanupAfterSignal(terminal) {
        return await Promise.race([
            this.waitForTerminalAndTrackedDescendants(terminal).then(() => true),
            waitMs(this.killGraceMs).then(() => false),
        ]);
    }
    async waitForTerminalAndTrackedDescendants(terminal) {
        await terminal.exitPromise;
        while (hasLiveTerminalProcessGroup(terminal)) {
            await waitMs(25);
        }
        while (hasLivePid(terminal.descendantPids)) {
            await waitMs(25);
        }
    }
}
async function spawnTerminalProcess(params, defaultCwd) {
    const directCommand = buildTerminalSpawnCommand(params.command, params.args);
    try {
        return {
            proc: await spawnAndWait(directCommand, params, defaultCwd),
            spawnCommand: directCommand,
        };
    }
    catch (error) {
        const fallbackCommand = params.args === undefined && isNotFoundSpawnError(error)
            ? buildTerminalFallbackSpawnCommand(params.command, params.cwd ?? defaultCwd)
            : undefined;
        if (!fallbackCommand) {
            throw error;
        }
        return {
            proc: await spawnAndWait(fallbackCommand, params, defaultCwd),
            spawnCommand: fallbackCommand,
        };
    }
}
async function spawnAndWait(spawnCommand, params, defaultCwd) {
    const spawnOptions = buildTerminalSpawnOptions(spawnCommand.command, params.cwd ?? defaultCwd, params.env);
    if (spawnCommand.killProcessGroup) {
        spawnOptions.detached = true;
    }
    // ACP terminal/create is a permission-gated command-execution surface.
    // CodeQL otherwise treats the intentional shell fallback as accidental injection.
    // codeql[js/shell-command-injection-from-environment]
    // lgtm[js/shell-command-injection-from-environment]
    const proc = spawn(spawnCommand.command, spawnCommand.args, spawnOptions);
    await waitForSpawn(proc);
    return proc;
}
function isNotFoundSpawnError(error) {
    return error instanceof Error && error.code === "ENOENT";
}
function buildTerminalFallbackSpawnCommand(command, cwd, platform = process.platform) {
    if (commandPathExists(command, cwd)) {
        return undefined;
    }
    if (platform === "win32") {
        return hasWindowsShellSyntax(command) || /\s/u.test(command)
            ? buildTerminalShellSpawnCommand(command, platform)
            : undefined;
    }
    if (hasShellSyntax(command) || /\s/u.test(command)) {
        return buildTerminalShellSpawnCommand(command, platform);
    }
    return undefined;
}
function hasShellSyntax(command) {
    return /[|&;<>()>$`*?[\]{}'"\\\r\n]/u.test(command);
}
function hasWindowsShellSyntax(command) {
    return /[|&;<>()>$`*?[\]{}'"\r\n]/u.test(command);
}
function commandPathExists(command, cwd) {
    if (!/[\\/]/u.test(command)) {
        return false;
    }
    const resolvedPath = path.isAbsolute(command) ? command : path.resolve(cwd, command);
    return fs.existsSync(resolvedPath);
}
async function listDescendantPids(rootPid) {
    let output;
    try {
        output = await runProcessListCommand();
    }
    catch {
        return [];
    }
    const childrenByParent = new Map();
    for (const line of output.split("\n")) {
        addProcessListLine(childrenByParent, line);
    }
    const descendants = [];
    const queue = [...(childrenByParent.get(rootPid) ?? [])];
    for (let index = 0; index < queue.length; index += 1) {
        const pid = queue[index];
        descendants.push(pid);
        queue.push(...(childrenByParent.get(pid) ?? []));
    }
    return descendants;
}
function addProcessListLine(childrenByParent, line) {
    const parsed = parseProcessListLine(line);
    if (!parsed) {
        return;
    }
    const children = childrenByParent.get(parsed.parentPid);
    if (children) {
        children.push(parsed.pid);
    }
    else {
        childrenByParent.set(parsed.parentPid, [parsed.pid]);
    }
}
function parseProcessListLine(line) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!match) {
        return undefined;
    }
    const pid = Number(match[1]);
    const parentPid = Number(match[2]);
    if (!Number.isInteger(pid) || !Number.isInteger(parentPid) || pid <= 0 || parentPid <= 0) {
        return undefined;
    }
    return { pid, parentPid };
}
async function runProcessListCommand() {
    if (process.platform === "win32") {
        return await runWindowsProcessListCommand();
    }
    return await new Promise((resolve, reject) => {
        const child = spawn("ps", ["-eo", "pid=,ppid="], {
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.once("error", reject);
        child.once("close", (code, signal) => {
            if (code === 0) {
                resolve(stdout);
                return;
            }
            reject(new Error(`ps exited with code ${code ?? "null"} signal ${signal ?? "null"}: ${stderr}`));
        });
    });
}
async function rememberProcessGroupPids(terminal) {
    const processGroupId = terminal.process.pid;
    if (!terminal.killProcessGroup || !processGroupId) {
        return;
    }
    if (process.platform === "win32") {
        for (const pid of await listDescendantPids(processGroupId)) {
            terminal.descendantPids.add(pid);
        }
        return;
    }
    for (const pid of await listProcessGroupPids(processGroupId)) {
        if (pid !== processGroupId) {
            terminal.descendantPids.add(pid);
        }
    }
}
async function listProcessGroupPids(processGroupId) {
    let output;
    try {
        output = await runProcessGroupListCommand();
    }
    catch {
        return [];
    }
    const pids = [];
    for (const line of output.split("\n")) {
        const match = line.trim().match(/^(\d+)\s+(\d+)$/);
        if (!match) {
            continue;
        }
        const pid = Number(match[1]);
        const pgid = Number(match[2]);
        if (Number.isInteger(pid) && Number.isInteger(pgid) && pid > 0 && pgid === processGroupId) {
            pids.push(pid);
        }
    }
    return pids;
}
async function runProcessGroupListCommand() {
    return await new Promise((resolve, reject) => {
        const child = spawn("ps", ["-eo", "pid=,pgid="], {
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.once("error", reject);
        child.once("close", (code, signal) => {
            if (code === 0) {
                resolve(stdout);
                return;
            }
            reject(new Error(`ps exited with code ${code ?? "null"} signal ${signal ?? "null"}: ${stderr}`));
        });
    });
}
async function runWindowsProcessListCommand() {
    return await new Promise((resolve, reject) => {
        const command = [
            "Get-CimInstance Win32_Process |",
            'ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }',
        ].join(" ");
        const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.once("error", reject);
        child.once("close", (code, signal) => {
            if (code === 0) {
                resolve(stdout);
                return;
            }
            reject(new Error(`powershell process list exited with code ${code ?? "null"} signal ${signal ?? "null"}: ${stderr}`));
        });
    });
}
async function killWindowsProcessTree(pid, signal) {
    const args = ["/pid", String(pid), "/t"];
    if (signal === "SIGKILL") {
        args.push("/f");
    }
    await new Promise((resolve) => {
        const child = spawn("taskkill", args, {
            stdio: ["ignore", "ignore", "ignore"],
            windowsHide: true,
        });
        child.once("error", () => resolve());
        child.once("close", () => resolve());
    });
}
function sendSignal(pid, signal) {
    try {
        process.kill(pid, signal);
    }
    catch {
        // Process tree cleanup is best-effort because descendants can exit between ps and kill.
    }
}
function hasLiveProcessGroup(processGroupId) {
    try {
        process.kill(-processGroupId, 0);
        return true;
    }
    catch {
        return false;
    }
}
function hasLiveTerminalProcessGroup(terminal) {
    const pid = terminal.process.pid;
    return Boolean(terminal.killProcessGroup && pid && process.platform !== "win32" && hasLiveProcessGroup(pid));
}
function hasLivePid(pids) {
    for (const pid of pids) {
        try {
            process.kill(pid, 0);
            return true;
        }
        catch {
            pids.delete(pid);
        }
    }
    return false;
}
