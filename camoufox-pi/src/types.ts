// Domain types shared across the extension.
// Populated per docs/superpowers/specs/2026-04-12-foundational-slice-design.md §4.1.

export interface CamoufoxConfig {
	readonly timeoutMs: number;
	readonly defaultEngine: "duckduckgo";
	readonly maxBytes: number;
}

export const DEFAULT_CONFIG: CamoufoxConfig = {
	timeoutMs: 30_000,
	defaultEngine: "duckduckgo",
	maxBytes: 2_097_152,
};
