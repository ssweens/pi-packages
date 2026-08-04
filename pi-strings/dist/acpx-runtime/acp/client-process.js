import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
export function normalizeAgentCommandInput(value) {
    if (typeof value === "string") {
        return { agentCommand: value };
    }
    const parts = toCommandParts([...value]);
    const argv = [parts.command, ...parts.args];
    return {
        agentCommand: renderArgvIdentity(argv),
        agentArgv: argv,
    };
}
const IDENTITY_SAFE_ARG_RE = /^[A-Za-z0-9_@%+=:,./^~-]+$/u;
export function renderArgvIdentity(argv) {
    return argv.map((arg) => (IDENTITY_SAFE_ARG_RE.test(arg) ? arg : JSON.stringify(arg))).join(" ");
}
export function isoNow() {
    return new Date().toISOString();
}
export function waitForSpawn(child) {
    return new Promise((resolve, reject) => {
        const onSpawn = () => {
            child.off("error", onError);
            resolve();
        };
        const onError = (error) => {
            child.off("spawn", onSpawn);
            reject(error);
        };
        child.once("spawn", onSpawn);
        child.once("error", onError);
    });
}
export function isChildProcessRunning(child) {
    return child.exitCode == null && child.signalCode == null;
}
export function requireAgentStdio(child) {
    if (!child.stdin || !child.stdout || !child.stderr) {
        throw new Error("ACP agent must be spawned with piped stdin/stdout/stderr");
    }
    return child;
}
export function waitForChildExit(child, timeoutMs) {
    if (!isChildProcessRunning(child)) {
        return Promise.resolve(true);
    }
    return new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
            finish(false);
        }, Math.max(0, timeoutMs));
        const finish = (value) => {
            if (settled) {
                return;
            }
            settled = true;
            child.off("close", onExitLike);
            child.off("exit", onExitLike);
            clearTimeout(timer);
            resolve(value);
        };
        const onExitLike = () => {
            finish(true);
        };
        child.once("close", onExitLike);
        child.once("exit", onExitLike);
    });
}
export function resolveAgentCommandParts(value, argv, platform = process.platform) {
    if (argv) {
        const parts = toCommandParts([...argv]);
        assertWindowsLaunchableCommand(parts.command, platform);
        return parts;
    }
    if (platform === "win32") {
        throw new Error('Raw agent command strings are not supported on Windows. Configure the agent with an argv array, for example: "argv": ["agent.exe", "--acp"]. Legacy agents.<name>.args arrays are migrated automatically. Existing sessions without saved argv must be closed and recreated.');
    }
    return splitCommandLine(value);
}
function assertWindowsLaunchableCommand(command, platform) {
    if (platform === "win32" && path.extname(command).toLowerCase() === ".sh") {
        throw new Error(`Windows cannot launch shell script executable "${command}" directly. Configure an explicit interpreter argv, for example: "argv": ["bash", "${command}"]. acpx does not infer interpreters.`);
    }
}
export function splitCommandLine(value) {
    const parts = [];
    let current = "";
    let quote = null;
    let escaping = false;
    let hasPart = false;
    for (const ch of value) {
        const next = readCommandLineChar({ ch, current, quote, escaping, parts, hasPart });
        current = next.current;
        quote = next.quote;
        escaping = next.escaping;
        hasPart = next.hasPart;
    }
    if (escaping) {
        current += "\\";
        hasPart = true;
    }
    if (quote) {
        throw new Error("Invalid --agent command: unterminated quote");
    }
    if (hasPart) {
        parts.push(current);
    }
    return toCommandParts(parts);
}
function toCommandParts(parts) {
    if (parts.length === 0 || parts[0] === "") {
        throw new Error("Invalid --agent command: empty command");
    }
    return {
        command: parts[0],
        args: parts.slice(1),
    };
}
function readCommandLineChar(state) {
    if (state.escaping) {
        return {
            current: state.current + state.ch,
            quote: state.quote,
            escaping: false,
            hasPart: true,
        };
    }
    if (state.ch === "\\" && state.quote !== "'") {
        return {
            current: state.current,
            quote: state.quote,
            escaping: true,
            hasPart: state.hasPart,
        };
    }
    if (state.quote) {
        return readQuotedCommandLineChar({
            ch: state.ch,
            current: state.current,
            quote: state.quote,
            hasPart: state.hasPart,
        });
    }
    return readUnquotedCommandLineChar(state);
}
function readQuotedCommandLineChar(state) {
    if (state.ch === state.quote) {
        return { current: state.current, quote: null, escaping: false, hasPart: true };
    }
    return {
        current: state.current + state.ch,
        quote: state.quote,
        escaping: false,
        hasPart: true,
    };
}
function readUnquotedCommandLineChar(state) {
    if (state.ch === "'" || state.ch === '"') {
        return { current: state.current, quote: state.ch, escaping: false, hasPart: true };
    }
    if (/\s/.test(state.ch)) {
        flushCommandLinePart(state.parts, state.current, state.hasPart);
        return { current: "", quote: null, escaping: false, hasPart: false };
    }
    return {
        current: state.current + state.ch,
        quote: null,
        escaping: false,
        hasPart: true,
    };
}
function flushCommandLinePart(parts, current, hasPart) {
    if (hasPart) {
        parts.push(current);
    }
}
export function asAbsoluteCwd(cwd) {
    return path.resolve(cwd);
}
export async function resolveAgentSessionCwd(cwd, agentCommand, options = {}) {
    const resolved = asAbsoluteCwd(cwd);
    if (!shouldTranslateWslWindowsCwd(agentCommand, options)) {
        return resolved;
    }
    const translated = (await (options.runWslpath ?? runWslpath)(resolved)).trim();
    if (!translated) {
        throw new Error(`wslpath returned an empty Windows path for cwd: ${resolved}`);
    }
    return translated;
}
function shouldTranslateWslWindowsCwd(agentCommand, options) {
    if (!isWsl(options)) {
        return false;
    }
    try {
        const { command } = splitCommandLine(agentCommand);
        return isWindowsExecutableCommand(command);
    }
    catch {
        return false;
    }
}
function isWsl(options) {
    const platform = options.platform ?? process.platform;
    if (platform !== "linux") {
        return false;
    }
    const existsSync = options.existsSync ?? fs.existsSync;
    return existsSync("/proc/sys/fs/binfmt_misc/WSLInterop");
}
const WINDOWS_EXECUTABLE_EXTENSION_RE = /\.(?:exe|cmd|bat)$/u;
function isWindowsExecutableCommand(command) {
    const normalized = command.toLowerCase();
    return WINDOWS_EXECUTABLE_EXTENSION_RE.test(normalized);
}
async function runWslpath(cwd) {
    const { stdout } = await execFileAsync("wslpath", ["-w", cwd], {
        encoding: "utf8",
    });
    return stdout;
}
export function basenameToken(value) {
    return path
        .basename(value)
        .toLowerCase()
        .replace(/\.(cmd|exe|bat)$/u, "");
}
