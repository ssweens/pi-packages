import fs from "node:fs";
import path from "node:path";
export function readWindowsEnvValue(env, key) {
    const matchedKey = Object.keys(env).find((entry) => entry.toUpperCase() === key);
    return matchedKey ? env[matchedKey] : undefined;
}
function windowsExecutableExtensions(env) {
    return (readWindowsEnvValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD")
        .split(";")
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0);
}
function commandCandidates(command, env) {
    const commandExtension = path.extname(command);
    if (commandExtension.length > 0) {
        return [command];
    }
    return windowsExecutableExtensions(env).map((extension) => `${command}${extension}`);
}
function commandHasPath(command) {
    return command.includes("/") || command.includes("\\") || path.isAbsolute(command);
}
function resolveWindowsPathCommand(command, env) {
    const candidates = commandCandidates(command, env);
    const pathValue = readWindowsEnvValue(env, "PATH");
    if (!pathValue) {
        return undefined;
    }
    for (const directory of pathValue.split(";")) {
        const resolved = findExistingCommandInDirectory(directory, candidates);
        if (resolved) {
            return resolved;
        }
    }
    return undefined;
}
function findExistingCommandInDirectory(directory, candidates) {
    const trimmedDirectory = directory.trim();
    if (trimmedDirectory.length === 0) {
        return undefined;
    }
    return candidates
        .map((candidate) => path.join(trimmedDirectory, candidate))
        .find((resolved) => fs.existsSync(resolved));
}
function resolveWindowsWrapperToken(token, wrapperPath) {
    const relative = token.match(/%~?dp0%?\s*[\\/]*(.*)$/i)?.[1]?.trim();
    if (!relative) {
        return undefined;
    }
    const candidate = path.resolve(path.dirname(wrapperPath), relative.replace(/[\\/]+/g, path.sep).replace(/^[\\/]+/, ""));
    return path.extname(candidate).toLowerCase() === ".exe" && fs.existsSync(candidate)
        ? candidate
        : undefined;
}
function resolveWindowsWrapperExecutable(wrapperPath) {
    if (!fs.existsSync(wrapperPath)) {
        return undefined;
    }
    try {
        const content = fs.readFileSync(wrapperPath, "utf8");
        return [...content.matchAll(/"([^"\r\n]*)"/g)]
            .map((match) => resolveWindowsWrapperToken(match[1] ?? "", wrapperPath))
            .find((candidate) => candidate !== undefined);
    }
    catch {
        // Ignore unreadable wrapper scripts and let callers use their fallback.
        return undefined;
    }
}
export function resolveWindowsCommand(command, env = process.env) {
    const candidates = commandCandidates(command, env);
    if (commandHasPath(command)) {
        return candidates.find((candidate) => fs.existsSync(candidate));
    }
    return resolveWindowsPathCommand(command, env);
}
/**
 * Resolve a Windows command to a native executable suitable for direct spawn.
 *
 * Batch and PowerShell shims are intentionally rejected unless they point at a
 * real `.exe` entrypoint. Callers that need shell execution should use the
 * command-specific shell policy instead.
 */
export function resolveWindowsExecutablePath(command, env = process.env) {
    const resolved = resolveWindowsCommand(command, env);
    if (!resolved) {
        return undefined;
    }
    const absolute = path.resolve(resolved);
    const extension = path.extname(absolute).toLowerCase();
    if (extension === ".exe") {
        return absolute;
    }
    if (extension !== ".cmd" && extension !== ".bat" && extension !== ".ps1") {
        return undefined;
    }
    const siblingExecutable = `${absolute.slice(0, -extension.length)}.exe`;
    return fs.existsSync(siblingExecutable)
        ? siblingExecutable
        : resolveWindowsWrapperExecutable(absolute);
}
function shouldUseWindowsBatchShell(command, platform = process.platform, env = process.env) {
    if (platform !== "win32") {
        return false;
    }
    const resolvedCommand = resolveWindowsCommand(command, env) ?? command;
    const ext = path.extname(resolvedCommand).toLowerCase();
    return ext === ".cmd" || ext === ".bat";
}
const CMD_META_CHAR_RE = /([()\][%!^"`<>&|;, *?])/gu;
const CMD_BACKSLASH_QUOTE_RE = /(?=(\\+?)?)\1"/gu;
const CMD_TRAILING_BACKSLASH_RE = /(?=(\\+?)?)\1$/gu;
const CMD_SHIM_RE = /node_modules[\\/].bin[\\/][^\\/]+\.cmd$/iu;
function escapeCmdCommand(value) {
    return value.replace(CMD_META_CHAR_RE, "^$1");
}
function escapeCmdArgument(value, doubleEscapeMeta) {
    const quoted = `"${value
        .replace(CMD_BACKSLASH_QUOTE_RE, '$1$1\\"')
        .replace(CMD_TRAILING_BACKSLASH_RE, "$1$1")}"`;
    const escaped = quoted.replace(CMD_META_CHAR_RE, "^$1");
    return doubleEscapeMeta ? escaped.replace(CMD_META_CHAR_RE, "^$1") : escaped;
}
export function buildAgentSpawnCommand(command, args, platform = process.platform, env = process.env) {
    if (!shouldUseWindowsBatchShell(command, platform, env)) {
        return { command, args: [...args] };
    }
    const resolvedCommand = path.win32.normalize(resolveWindowsCommand(command, env) ?? command);
    const doubleEscapeMeta = CMD_SHIM_RE.test(resolvedCommand);
    const shellCommand = [
        escapeCmdCommand(resolvedCommand),
        ...args.map((arg) => escapeCmdArgument(arg, doubleEscapeMeta)),
    ].join(" ");
    return {
        command: readWindowsEnvValue(env, "COMSPEC") ?? "cmd.exe",
        args: ["/d", "/s", "/c", `"${shellCommand}"`],
        windowsVerbatimArguments: true,
    };
}
export function buildSpawnCommandOptions(command, options, platform = process.platform, env = process.env) {
    if (!shouldUseWindowsBatchShell(command, platform, env)) {
        return options;
    }
    return {
        ...options,
        shell: true,
    };
}
export function buildTerminalSpawnCommand(command, args) {
    return { command, args: args ?? [], killProcessGroup: false };
}
export function buildTerminalShellSpawnCommand(command, platform = process.platform) {
    if (platform === "win32") {
        return { command: "cmd.exe", args: ["/d", "/s", "/c", command], killProcessGroup: true };
    }
    return { command: "/bin/sh", args: ["-c", command], killProcessGroup: true };
}
