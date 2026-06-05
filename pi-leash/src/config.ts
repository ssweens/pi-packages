/**
 * Configuration schema for the Pi Leash extension.
 *
 * Reads from ~/.pi/agent/settings/pi-leash.json (if present).
 * All fields are optional — sensible defaults are used when not specified.
 *
 * Example config:
 * {
 *   "enabled": true,
 *   "features": {
 *     "policies": true,
 *     "permissionGate": true
 *   },
 *   "permissionGate": {
 *     "sudoMode": {
 *       "enabled": true,
 *       "timeout": 30000
 *     }
 *   }
 * }
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

export function getConfigPath(): string {
  return join(getAgentDir(), "settings", "pi-leash.json");
}

/**
 * A pattern with explicit matching mode.
 * Default: glob for files, substring for commands.
 * regex: true means full regex matching.
 */
export interface PatternConfig {
  pattern: string;
  regex?: boolean;
}

/**
 * Permission gate pattern. When regex is false (default), the pattern
 * is matched as substring against the raw command string.
 * When regex is true, uses full regex against the raw string.
 */
export interface DangerousPattern extends PatternConfig {
  description: string;
}

/**
 * Protection level for a policy rule.
 */
export type Protection = "none" | "readOnly" | "noAccess";

/**
 * Path access mode for restricting tool access to the working directory.
 */
export type PathAccessMode = "allow" | "ask" | "block";

/**
 * A named policy rule. Matches files by patterns and enforces a protection level.
 */
export interface PolicyRule {
  /** Stable identifier used for deduplication across scopes. */
  id: string;
  /** Optional display name for settings/UI. */
  name?: string;
  /** Human-readable description. */
  description?: string;
  /** File patterns to protect. */
  patterns: PatternConfig[];
  /** Optional exceptions. */
  allowedPatterns?: PatternConfig[];
  /** Protection level. */
  protection: Protection;
  /** Block only when file exists on disk. Default true. */
  onlyIfExists?: boolean;
  /** Message shown when blocked; supports {file} placeholder. */
  blockMessage?: string;
  /** Per-rule toggle. Default true. */
  enabled?: boolean;
}

/**
 * User-facing guardrails configuration.
 * All fields are optional - defaults are applied.
 */
export interface GuardrailsConfig {
  /** Enable/disable guardrails entirely. Default: true */
  enabled?: boolean;
  /** Feature toggles */
  features?: {
    /** Enable file protection policies. Default: true */
    policies?: boolean;
    /** Enable permission gate for dangerous commands. Default: true */
    permissionGate?: boolean;
    /** Enable path access restrictions. Default: false */
    pathAccess?: boolean;
  };
  /** File protection policies */
  policies?: {
    /** Custom rules to add to the default secret-files rule */
    rules?: PolicyRule[];
  };
  /** Path access configuration */
  pathAccess?: {
    /** Access mode: allow (no restrictions), ask (prompt), block (deny). Default: ask */
    mode?: PathAccessMode;
    /** Paths outside cwd that are always allowed. Trailing / = directory grant. */
    allowedPaths?: string[];
  };
  /** Permission gate configuration */
  permissionGate?: {
    /** Additional dangerous patterns to watch for */
    patterns?: DangerousPattern[];
    /** Require confirmation before executing dangerous commands. Default: true */
    requireConfirmation?: boolean;
    /** Patterns that bypass the permission gate */
    allowedPatterns?: PatternConfig[];
    /** Patterns that are automatically denied */
    autoDenyPatterns?: PatternConfig[];
    /** Use LLM to explain commands before confirmation. Default: false */
    explainCommands?: boolean;
    /** Model to use for explanations (format: provider/model-id) */
    explainModel?: string;
    /** Timeout for explanation requests. Default: 5000 */
    explainTimeout?: number;
    /** Sudo mode configuration */
    sudoMode?: {
      /** Enable sudo password prompts and execution. Default: false */
      enabled?: boolean;
      /** Command timeout in milliseconds. Default: 30000 */
      timeout?: number;
      /** Preserve environment with sudo -E. Default: false */
      preserveEnv?: boolean;
      /**
       * Show a "Remember password for N minutes" toggle in the sudo password
       * dialog. When the user opts in, the password is cached in-memory only
       * (never written to disk) for `cacheTtl` milliseconds so subsequent
       * sudo prompts skip the password step. The approval dialog still runs
       * every time. Default: true.
       */
      cacheEnabled?: boolean;
      /** Cache TTL in milliseconds. Default: 300000 (5 minutes). */
      cacheTtl?: number;
      /**
       * Maximum number of password attempts before giving up.
       * Mirrors real sudo behavior. Default: 3.
       */
      maxRetries?: number;
    };
  };
}

/**
 * Resolved configuration with all defaults applied.
 */
export interface ResolvedConfig {
  enabled: boolean;
  features: {
    policies: boolean;
    permissionGate: boolean;
    pathAccess: boolean;
  };
  policies: {
    rules: PolicyRule[];
  };
  pathAccess: {
    mode: PathAccessMode;
    allowedPaths: string[];
  };
  permissionGate: {
    patterns: DangerousPattern[];
    useBuiltinMatchers: boolean;
    requireConfirmation: boolean;
    allowedPatterns: PatternConfig[];
    autoDenyPatterns: PatternConfig[];
    explainCommands: boolean;
    explainModel: string | null;
    explainTimeout: number;
    sudoMode: {
      enabled: boolean;
      timeout: number;
      preserveEnv: boolean;
      cacheEnabled: boolean;
      cacheTtl: number;
      maxRetries: number;
    };
  };
}

const DEFAULT_SECRET_FILES_RULE: PolicyRule = {
  id: "secret-files",
  description: "Files containing secrets",
  patterns: [
    { pattern: ".env" },
    { pattern: ".env.local" },
    { pattern: ".env.production" },
    { pattern: ".env.prod" },
    { pattern: ".dev.vars" },
  ],
  allowedPatterns: [
    { pattern: "*.example.env" },
    { pattern: "*.sample.env" },
    { pattern: "*.test.env" },
    { pattern: ".env.example" },
    { pattern: ".env.sample" },
    { pattern: ".env.test" },
  ],
  protection: "noAccess",
  onlyIfExists: true,
  blockMessage:
    "Accessing {file} is not allowed. This file contains secrets. " +
    "Explain to the user why you want to access this file, and if changes are needed ask the user to make them.",
  enabled: true,
};

const DEFAULT_DANGEROUS_PATTERNS: DangerousPattern[] = [
  { pattern: "rm -rf", description: "recursive force delete" },
  { pattern: "sudo", description: "superuser command" },
  { pattern: "dd if=", description: "disk write operation" },
  { pattern: "mkfs.", description: "filesystem format" },
  { pattern: "chmod -R 777", description: "insecure recursive permissions" },
  { pattern: "chown -R", description: "recursive ownership change" },
  {
    pattern: "git checkout",
    description: "branch switch or discard uncommitted changes",
  },
];

function mergeConfig(userConfig: GuardrailsConfig): ResolvedConfig {
  // Build policies: default secret-files rule + user rules
  const policies: ResolvedConfig["policies"] = {
    rules: [DEFAULT_SECRET_FILES_RULE, ...(userConfig.policies?.rules ?? [])],
  };

  // Build permission gate settings
  const pg = userConfig.permissionGate ?? {};
  const permissionGate: ResolvedConfig["permissionGate"] = {
    patterns: [...DEFAULT_DANGEROUS_PATTERNS, ...(pg.patterns ?? [])],
    useBuiltinMatchers: true,
    requireConfirmation: pg.requireConfirmation ?? true,
    allowedPatterns: pg.allowedPatterns ?? [],
    autoDenyPatterns: pg.autoDenyPatterns ?? [],
    explainCommands: pg.explainCommands ?? false,
    explainModel: pg.explainModel ?? null,
    explainTimeout: pg.explainTimeout ?? 5000,
    sudoMode: {
      enabled: pg.sudoMode?.enabled ?? true,
      timeout: pg.sudoMode?.timeout ?? 30000,
      preserveEnv: pg.sudoMode?.preserveEnv ?? false,
      cacheEnabled: pg.sudoMode?.cacheEnabled ?? true,
      cacheTtl: pg.sudoMode?.cacheTtl ?? 300000,
      maxRetries: pg.sudoMode?.maxRetries ?? 3,
    },
  };

  // Build path access settings
  const pathAccess: ResolvedConfig["pathAccess"] = {
    mode: userConfig.pathAccess?.mode ?? "ask",
    allowedPaths: userConfig.pathAccess?.allowedPaths ?? [],
  };

  return {
    enabled: userConfig.enabled ?? true,
    features: {
      policies: userConfig.features?.policies ?? true,
      permissionGate: userConfig.features?.permissionGate ?? true,
      pathAccess: userConfig.features?.pathAccess ?? false,
    },
    policies,
    pathAccess,
    permissionGate,
  };
}

let _cachedConfig: ResolvedConfig | null = null;

/**
 * Load and merge configuration from global settings.
 * Caches the result for the session.
 */
export function loadConfig(): ResolvedConfig {
  if (_cachedConfig !== null) {
    return _cachedConfig;
  }

  const configPath = getConfigPath();
  let userConfig: GuardrailsConfig = {};

  if (existsSync(configPath)) {
    try {
      userConfig = JSON.parse(
        readFileSync(configPath, "utf-8"),
      ) as GuardrailsConfig;
    } catch (err) {
      console.warn(`[pi-leash] Failed to parse ${configPath}: ${err}`);
    }
  }

  _cachedConfig = mergeConfig(userConfig);
  return _cachedConfig;
}

/**
 * Clear the cached configuration.
 * Call this if the config file changes during a session.
 */
export function clearConfigCache(): void {
  _cachedConfig = null;
}

/**
 * Get the current configuration (cached).
 * Same as loadConfig() but semantically clearer when you know it's already loaded.
 */
export function getConfig(): ResolvedConfig {
  return loadConfig();
}
