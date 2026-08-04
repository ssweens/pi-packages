import fs from "node:fs";
type BuiltInAgentPackageSpec = {
    packageName: string;
    packageRange: string;
    preferredBinName: string;
    fallbackCommand: string;
    legacyFallbackCommands?: string[];
};
type BuiltInAgentLaunch = {
    source: "installed" | "package-exec";
    command: string;
    args: string[];
    packageName: string;
    packageRange: string;
    packageVersion?: string;
    binPath?: string;
    npmCliPath?: string;
};
type BuiltInLaunchResolverOptions = {
    existsSync?: (path: string) => boolean;
    readFileSync?: typeof fs.readFileSync;
    resolvePackageRoot?: (packageName: string) => string;
    execPath?: string;
    resolveNpmCliPath?: (execPath: string) => string;
};
export declare const AGENT_REGISTRY: Record<string, string>;
export declare const AGENT_ARGV_REGISTRY: Record<string, string[]>;
export declare const BUILT_IN_AGENT_PACKAGES: {
    readonly codex: {
        readonly packageName: "@agentclientprotocol/codex-acp";
        readonly packageRange: "^1.1.5";
        readonly preferredBinName: "codex-acp";
        readonly fallbackCommand: string;
        readonly legacyFallbackCommands: [];
    };
    readonly claude: {
        readonly packageName: "@agentclientprotocol/claude-agent-acp";
        readonly packageRange: "^0.60.0";
        readonly preferredBinName: "claude-agent-acp";
        readonly fallbackCommand: string;
        readonly legacyFallbackCommands: ["npm exec @agentclientprotocol/claude-agent-acp@^0.60.0"];
    };
};
export declare const DEFAULT_AGENT_NAME = "codex";
export declare function normalizeAgentName(value: string): string;
export declare function resolveCanonicalAgentName(value: string): string;
export declare function mergeAgentRegistry(overrides?: Record<string, string>): Record<string, string>;
export declare function resolveAgentCommand(agentName: string, overrides?: Record<string, string>): string;
export declare function resolveAgentArgv(agentName: string): string[] | undefined;
export declare function findBuiltInAgentPackage(agentCommand: string): BuiltInAgentPackageSpec | undefined;
export declare function resolveInstalledBuiltInAgentLaunch(agentCommand: string, options?: BuiltInLaunchResolverOptions): BuiltInAgentLaunch | undefined;
export declare function resolvePackageExecBuiltInAgentLaunch(agentCommand: string, options?: BuiltInLaunchResolverOptions): BuiltInAgentLaunch | undefined;
export declare function resolveBuiltInAgentLaunch(agentCommand: string, options?: BuiltInLaunchResolverOptions): BuiltInAgentLaunch | undefined;
export declare function listBuiltInAgents(overrides?: Record<string, unknown>): string[];
export {};
