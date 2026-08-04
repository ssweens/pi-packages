import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ACP_ADAPTER_PACKAGE_RANGES = {
    pi: "^0.0.31",
    codex: "^1.1.5",
    claude: "^0.60.0",
    mux: "^0.28.0",
};
export const AGENT_REGISTRY = {
    pi: `npx pi-acp@${ACP_ADAPTER_PACKAGE_RANGES.pi}`,
    openclaw: "openclaw acp",
    codex: `npx -y @agentclientprotocol/codex-acp@${ACP_ADAPTER_PACKAGE_RANGES.codex}`,
    claude: `npx -y @agentclientprotocol/claude-agent-acp@${ACP_ADAPTER_PACKAGE_RANGES.claude}`,
    gemini: "gemini --acp",
    cursor: "cursor-agent acp",
    copilot: "copilot --acp --stdio",
    droid: "droid exec --output-format acp",
    "fast-agent": "uvx fast-agent-mcp acp",
    "grok-build": "grok agent stdio",
    iflow: "iflow --experimental-acp",
    kilocode: "npx -y @kilocode/cli acp",
    kimi: "kimi acp",
    kiro: "kiro-cli-chat acp",
    mux: `npx -y mux@${ACP_ADAPTER_PACKAGE_RANGES.mux} acp`,
    opencode: "npx -y opencode-ai acp",
    pool: "pool acp",
    qoder: "qodercli --acp",
    qwen: "qwen --acp",
    trae: "traecli acp serve",
    zeroclaw: "zeroclaw acp",
};
export const AGENT_ARGV_REGISTRY = {
    pi: ["npx", `pi-acp@${ACP_ADAPTER_PACKAGE_RANGES.pi}`],
    openclaw: ["openclaw", "acp"],
    codex: ["npx", "-y", `@agentclientprotocol/codex-acp@${ACP_ADAPTER_PACKAGE_RANGES.codex}`],
    claude: [
        "npx",
        "-y",
        `@agentclientprotocol/claude-agent-acp@${ACP_ADAPTER_PACKAGE_RANGES.claude}`,
    ],
    gemini: ["gemini", "--acp"],
    cursor: ["cursor-agent", "acp"],
    copilot: ["copilot", "--acp", "--stdio"],
    droid: ["droid", "exec", "--output-format", "acp"],
    "fast-agent": ["uvx", "fast-agent-mcp", "acp"],
    "grok-build": ["grok", "agent", "stdio"],
    iflow: ["iflow", "--experimental-acp"],
    kilocode: ["npx", "-y", "@kilocode/cli", "acp"],
    kimi: ["kimi", "acp"],
    kiro: ["kiro-cli-chat", "acp"],
    mux: ["npx", "-y", `mux@${ACP_ADAPTER_PACKAGE_RANGES.mux}`, "acp"],
    opencode: ["npx", "-y", "opencode-ai", "acp"],
    pool: ["pool", "acp"],
    qoder: ["qodercli", "--acp"],
    qwen: ["qwen", "--acp"],
    trae: ["traecli", "acp", "serve"],
    zeroclaw: ["zeroclaw", "acp"],
};
export const BUILT_IN_AGENT_PACKAGES = {
    codex: {
        packageName: "@agentclientprotocol/codex-acp",
        packageRange: ACP_ADAPTER_PACKAGE_RANGES.codex,
        preferredBinName: "codex-acp",
        fallbackCommand: AGENT_REGISTRY.codex,
        legacyFallbackCommands: [],
    },
    claude: {
        packageName: "@agentclientprotocol/claude-agent-acp",
        packageRange: ACP_ADAPTER_PACKAGE_RANGES.claude,
        preferredBinName: "claude-agent-acp",
        fallbackCommand: AGENT_REGISTRY.claude,
        legacyFallbackCommands: [
            `npm exec @agentclientprotocol/claude-agent-acp@${ACP_ADAPTER_PACKAGE_RANGES.claude}`,
        ],
    },
};
const AGENT_ALIASES = {
    "factory-droid": "droid",
    factorydroid: "droid",
};
export const DEFAULT_AGENT_NAME = "codex";
export function normalizeAgentName(value) {
    return value.trim().toLowerCase();
}
export function resolveCanonicalAgentName(value) {
    const normalized = normalizeAgentName(value);
    return AGENT_ALIASES[normalized] ?? normalized;
}
export function mergeAgentRegistry(overrides) {
    if (!overrides) {
        return { ...AGENT_REGISTRY };
    }
    const merged = { ...AGENT_REGISTRY };
    for (const [name, command] of Object.entries(overrides)) {
        const normalized = normalizeAgentName(name);
        if (!normalized || !command.trim()) {
            continue;
        }
        merged[normalized] = command.trim();
    }
    return merged;
}
export function resolveAgentCommand(agentName, overrides) {
    const normalized = normalizeAgentName(agentName);
    const registry = mergeAgentRegistry(overrides);
    return registry[normalized] ?? registry[AGENT_ALIASES[normalized] ?? normalized] ?? agentName;
}
export function resolveAgentArgv(agentName) {
    const normalized = normalizeAgentName(agentName);
    const argv = AGENT_ARGV_REGISTRY[normalized] ?? AGENT_ARGV_REGISTRY[resolveCanonicalAgentName(agentName)];
    return argv ? [...argv] : undefined;
}
export function findBuiltInAgentPackage(agentCommand) {
    const normalized = agentCommand.trim();
    const builtInAgentPackages = Object.values(BUILT_IN_AGENT_PACKAGES);
    return builtInAgentPackages.find((spec) => spec.fallbackCommand === normalized || spec.legacyFallbackCommands?.includes(normalized));
}
function defaultResolvePackageRoot(packageName) {
    const segments = packageName.split("/");
    let cursor = path.dirname(fileURLToPath(import.meta.url));
    while (true) {
        const candidateRoot = path.join(cursor, "node_modules", ...segments);
        const manifestPath = path.join(candidateRoot, "package.json");
        if (fs.existsSync(manifestPath)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
                if (parsed.name === packageName) {
                    return candidateRoot;
                }
            }
            catch {
                // best effort; keep walking upward
            }
        }
        const parent = path.dirname(cursor);
        if (parent === cursor) {
            throw new Error(`Built-in agent package not found: ${packageName}`);
        }
        cursor = parent;
    }
}
function resolvePackageBin(spec, manifest) {
    if (typeof manifest.bin === "string") {
        return manifest.bin;
    }
    if (!manifest.bin || typeof manifest.bin !== "object") {
        return undefined;
    }
    return (manifest.bin[spec.preferredBinName] ??
        (Object.keys(manifest.bin).length === 1 ? Object.values(manifest.bin)[0] : undefined));
}
function defaultResolveNpmCliPath(execPath) {
    const candidate = path.resolve(path.dirname(execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
    if (!fs.existsSync(candidate)) {
        throw new Error(`npm CLI not found for execPath: ${execPath}`);
    }
    return candidate;
}
export function resolveInstalledBuiltInAgentLaunch(agentCommand, options = {}) {
    const spec = findBuiltInAgentPackage(agentCommand);
    if (!spec) {
        return undefined;
    }
    const readFileSync = options.readFileSync ?? fs.readFileSync;
    const existsSync = options.existsSync ?? fs.existsSync;
    const resolvePackageRoot = options.resolvePackageRoot ?? defaultResolvePackageRoot;
    try {
        const resolved = resolveInstalledBuiltInAgentPackage(spec, {
            readFileSync,
            existsSync,
            resolvePackageRoot,
        });
        if (!resolved) {
            return undefined;
        }
        return {
            source: "installed",
            command: process.execPath,
            args: [resolved.binPath],
            packageName: spec.packageName,
            packageRange: spec.packageRange,
            packageVersion: resolved.packageVersion,
            binPath: resolved.binPath,
        };
    }
    catch {
        return undefined;
    }
}
function resolveInstalledBuiltInAgentPackage(spec, options) {
    const packageRoot = options.resolvePackageRoot(spec.packageName);
    const manifest = JSON.parse(options.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
    if (manifest.name !== spec.packageName) {
        return undefined;
    }
    const relativeBinPath = resolvePackageBin(spec, manifest);
    if (!relativeBinPath) {
        return undefined;
    }
    const binPath = path.resolve(packageRoot, relativeBinPath);
    return options.existsSync(binPath) ? { packageVersion: manifest.version, binPath } : undefined;
}
export function resolvePackageExecBuiltInAgentLaunch(agentCommand, options = {}) {
    const spec = findBuiltInAgentPackage(agentCommand);
    if (!spec) {
        return undefined;
    }
    const existsSync = options.existsSync ?? fs.existsSync;
    const execPath = options.execPath ?? process.execPath;
    const resolveNpmCliPath = options.resolveNpmCliPath ?? defaultResolveNpmCliPath;
    try {
        const npmCliPath = resolveNpmCliPath(execPath);
        if (!existsSync(npmCliPath)) {
            return undefined;
        }
        return {
            source: "package-exec",
            command: execPath,
            args: [
                npmCliPath,
                "exec",
                "--yes",
                `--package=${spec.packageName}@${spec.packageRange}`,
                "--",
                spec.preferredBinName,
            ],
            packageName: spec.packageName,
            packageRange: spec.packageRange,
            npmCliPath,
        };
    }
    catch {
        return undefined;
    }
}
export function resolveBuiltInAgentLaunch(agentCommand, options = {}) {
    return (resolveInstalledBuiltInAgentLaunch(agentCommand, options) ??
        resolvePackageExecBuiltInAgentLaunch(agentCommand, options));
}
export function listBuiltInAgents(overrides) {
    return [...new Set([...Object.keys(AGENT_REGISTRY), ...Object.keys(overrides ?? {})])];
}
