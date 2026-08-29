import { homedir } from "node:os";
import { dirname, join } from "node:path";
import * as fs from "node:fs/promises";

/**
 * pi-omp configuration.
 *
 * `features` controls which modules are installed at extension load time.
 * The rest are per-feature settings. Config is merged from
 * `~/.pi/agent/pi-omp.json` (global) then `<cwd>/.pi/pi-omp.json` (project wins).
 */

export const FEATURE_KEYS = [
	"persona",
	"engineering",
	"keywords",
	"roles",
	"todo",
	"autoThinking",
	"autoLearn",
	"commit",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type PersonaName = "default" | "friendly" | "pragmatic";

export interface TodoConfig {
	/** Default phase name for new tasks. */
	defaultPhase: string;
	/** TODO.md path (relative to cwd). */
	file: string;
	/** Emit incomplete-work reminders on agent_end. */
	reminders: boolean;
	/** Max reminders sent per session. */
	maxReminders: number;
}

export interface AutoThinkingConfig {
	/** Classifier model: a model id, "provider/model", or role name. */
	classifierModel: string;
	/** Classifier call timeout. */
	timeoutMs: number;
	/** Use the coarse local-label classifier prompt. */
	localLabels: boolean;
}

export interface AutoLearnConfig {
	/** Minimum number of tool results in a turn before offering to learn. */
	minToolActivity: number;
	/** Skills dir managed by auto-learn (relative to cwd). */
	skillsDir: string;
}

export interface CommitConfig {
	/** Only analyze and preview; require explicit confirmation to commit. */
	dryRun: boolean;
}

export type RoleThinking = "low" | "medium" | "high" | "xhigh";

/** Per-role model binding. An explicit `model` overrides pattern matching (auto). */
export interface RoleModelConfig {
	/** Exact model ("provider/id" or id) to bind to the role. Omit for auto (pattern match). */
	model?: string;
	/** Thinking level for the role. Omit for the role's default. */
	thinking?: RoleThinking;
	/** Whether the role is active (shown in /role + the ctrl+shift+r cycle). Default true. */
	enabled?: boolean;
}

export interface PiOmpConfig {
	features: Record<FeatureKey, boolean>;
	persona: PersonaName;
	todo: TodoConfig;
	autoThinking: AutoThinkingConfig;
	autoLearn: AutoLearnConfig;
	commit: CommitConfig;
	/** Per-role model bindings (override of the hardcoded role presets). */
	roles: Record<string, RoleModelConfig>;
}

export const DEFAULT_CONFIG: PiOmpConfig = {
	features: {
		persona: true,
		engineering: true,
		keywords: true,
		roles: true,
		todo: true,
		autoThinking: false,
		autoLearn: false,
		commit: false,
	},
	persona: "default",
	todo: {
		defaultPhase: "Tasks",
		file: "TODO.md",
		reminders: true,
		maxReminders: 2,
	},
	autoThinking: {
		classifierModel: "@smol",
		timeoutMs: 4000,
		localLabels: false,
	},
	autoLearn: {
		minToolActivity: 3,
		skillsDir: ".pi/skills/learned",
	},
	commit: {
		dryRun: true,
	},
	roles: {},
};

export const CONFIG_FILENAME = "pi-omp.json";

function globalConfigDir(): string {
	return join(homedir(), ".pi", "agent");
}

export function globalConfigPath(): string {
	return join(globalConfigDir(), CONFIG_FILENAME);
}

export function projectConfigPath(cwd: string): string {
	return join(cwd, ".pi", CONFIG_FILENAME);
}

function asRecord(v: unknown): Record<string, unknown> | null {
	return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function mergeSection<T>(base: T, patch: unknown): T {
	return { ...(base as object), ...(patch as object) } as T;
}

/** Merge a partial config record over defaults (shallow per section). */
function mergeConfig(base: PiOmpConfig, patch: unknown): PiOmpConfig {
	const p = asRecord(patch);
	if (!p) return base;
	const next = { ...base };

	if (asRecord(p.features)) {
		next.features = { ...base.features, ...(p.features as Record<string, boolean>) };
	}
	if (typeof p.persona === "string") {
		next.persona = p.persona as PersonaName;
	}
	const sections = p as unknown as Partial<Pick<PiOmpConfig, "todo" | "autoThinking" | "autoLearn" | "commit">>;
	if (asRecord(sections.todo)) next.todo = mergeSection(base.todo, sections.todo);
	if (asRecord(sections.autoThinking)) next.autoThinking = mergeSection(base.autoThinking, sections.autoThinking);
	if (asRecord(sections.autoLearn)) next.autoLearn = mergeSection(base.autoLearn, sections.autoLearn);
	if (asRecord(sections.commit)) next.commit = mergeSection(base.commit, sections.commit);
	if (asRecord((p as { roles?: unknown }).roles)) {
		next.roles = { ...base.roles, ...((p as { roles?: Record<string, RoleModelConfig> }).roles ?? {}) };
	}
	return next;
}

function isEnoent(err: unknown): boolean {
	return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

async function readJson(path: string): Promise<unknown | null> {
	try {
		return JSON.parse(await fs.readFile(path, "utf8"));
	} catch (err) {
		if (isEnoent(err)) return null;
		throw err;
	}
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await fs.access(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Load config by merging defaults, the global file, then the project file.
 * Missing files are ignored.
 */
export async function loadConfig(cwd: string): Promise<PiOmpConfig> {
	const global = await readJson(globalConfigPath());
	const project = await readJson(projectConfigPath(cwd));
	return mergeConfig(mergeConfig(structuredClone(DEFAULT_CONFIG), global), project);
}

/**
 * Save a config. Writes to the project file if one already exists (keeps the
 * project-scoped override authoritative), otherwise the global file.
 */
	export async function saveConfig(cwd: string, config: PiOmpConfig): Promise<string> {
	const projectPath = projectConfigPath(cwd);
	const target = (await pathExists(projectPath)) ? projectPath : globalConfigPath();
	await fs.mkdir(dirname(target), { recursive: true });
	await fs.writeFile(target, JSON.stringify(config, null, 2) + "\n", "utf8");
	return target;
}

export function isFeatureEnabled(config: PiOmpConfig, key: FeatureKey): boolean {
	return config.features[key] === true;
}
