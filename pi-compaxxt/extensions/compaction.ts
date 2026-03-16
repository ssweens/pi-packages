/**
 * Pi-Compaxxt Compaction Extension
 *
 * Enhances pi's default compaction with two features:
 *
 * 1. Session context block prepended to every summary — session file path and
 *    thread ID so the post-compaction LLM can use session_query to retrieve
 *    older context that was summarized away.
 *
 * 2. LLM-judged <important-files> section — the compaction prompt is augmented
 *    to ask the LLM to identify the most goal-relevant files as part of
 *    generating the summary (one LLM call, no extra cost). The file sections
 *    are then restructured:
 *      <important-files>    — LLM-ranked top 3-5 files
 *      <modified-files>     — all modified files, unchanged from default
 *      <other-read-files>   — read-only files minus the important ones
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { compact } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Session context block
// ---------------------------------------------------------------------------

function buildSessionContextBlock(
	sessionFile: string | undefined,
	leafId: string | null,
): string {
	const lines: string[] = ["## Session Context"];
	if (sessionFile) lines.push(`**Session:** \`${sessionFile}\``);
	if (leafId) lines.push(`**Thread ID:** \`${leafId}\``);
	lines.push(
		"",
		"Use the `session_query` tool to retrieve specific context from messages that were summarized away.",
		"",
		"---",
		"",
	);
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Retry logic for transient HTTP errors
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

function isRetryableError(error: unknown): boolean {
	if (error instanceof Error) {
		// 503 Service Unavailable, 502 Bad Gateway, 504 Gateway Timeout
		// Also handle network errors and rate limits (429)
		const message = error.message.toLowerCase();
		return (
			message.includes("503") ||
			message.includes("502") ||
			message.includes("504") ||
			message.includes("429") ||
			message.includes("service unavailable") ||
			message.includes("bad gateway") ||
			message.includes("gateway timeout") ||
			message.includes("too many requests") ||
			message.includes("network error") ||
			message.includes("fetch failed") ||
			message.includes("econnreset") ||
			message.includes("etimedout")
		);
	}
	return false;
}

async function retryWithBackoff<T>(
	operation: () => Promise<T>,
	operationName: string,
): Promise<T> {
	let lastError: Error | undefined;

	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			return await operation();
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));

			if (!isRetryableError(lastError) || attempt === MAX_RETRIES - 1) {
				throw lastError;
			}

			const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
			console.warn(
				`pi-compaxxt: ${operationName} failed (attempt ${attempt + 1}/${MAX_RETRIES}): ${lastError.message}. Retrying in ${delay}ms...`,
			);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	throw lastError;
}

// ---------------------------------------------------------------------------
// Important files: parsing + file section restructuring
// ---------------------------------------------------------------------------

/**
 * Parse the ## Most Important Files section from the LLM summary.
 * Validates each path against the known file list to guard against hallucination.
 */
function parseImportantFiles(summary: string, knownFiles: Set<string>): string[] {
	const match = summary.match(/\n## Most Important Files\n([\s\S]+?)(?=\n\n<|$)/);
	if (!match) return [];

	return match[1]
		.split("\n")
		.map((line) => line.replace(/^[-*]\s*/, "").trim()) // strip bullets if LLM added them
		.map((line) => line.split(/\s+/)[0]) // strip any inline explanation after the path
		.filter((path) => path.length > 0 && knownFiles.has(path));
}

/**
 * Restructure the file XML sections in the summary:
 *   - Remove ## Most Important Files from markdown (now encoded in XML)
 *   - Remove <read-files> and replace with <other-read-files> (pruned)
 *   - Insert <important-files> before <modified-files>
 *   - Leave <modified-files> untouched (may overlap with important-files — intentional)
 */
function restructureFileSections(
	summary: string,
	importantFiles: string[],
	readFiles: string[],
): string {
	const importantSet = new Set(importantFiles);

	// Remove the ## Most Important Files markdown section
	let result = summary.replace(/\n## Most Important Files\n[\s\S]+?(?=\n\n<|$)/, "");

	// Remove the existing <read-files> block entirely
	result = result.replace(/\n\n<read-files>\n[\s\S]+?\n<\/read-files>/, "");

	// Compute other-read-files: read-only files not in the important list
	const otherReadFiles = readFiles.filter((f) => !importantSet.has(f));

	const importantSection = `<important-files>\n${importantFiles.join("\n")}\n</important-files>`;
	const otherReadSection =
		otherReadFiles.length > 0
			? `<other-read-files>\n${otherReadFiles.join("\n")}\n</other-read-files>`
			: "";

	// Insert <important-files> before <modified-files> if present, otherwise append
	if (result.includes("<modified-files>")) {
		result = result.replace(
			"\n\n<modified-files>",
			`\n\n${importantSection}\n\n<modified-files>`,
		);
		if (otherReadSection) {
			result = result.replace("</modified-files>", `</modified-files>\n\n${otherReadSection}`);
		}
	} else {
		// Read-only session — no modified-files section
		result += `\n\n${importantSection}`;
		if (otherReadSection) result += `\n\n${otherReadSection}`;
	}

	return result;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	pi.on("session_before_compact", async (event, ctx) => {
		if (!ctx.model) return;

		const apiKey = await ctx.modelRegistry.getApiKey(ctx.model);
		if (!apiKey) return;

		const { preparation, customInstructions: userInstructions, signal } = event;

		// Equivalent to computeFileLists() from compaction/utils — not re-exported by the package
		const modified = new Set([...preparation.fileOps.edited, ...preparation.fileOps.written]);
		const readFiles = [...preparation.fileOps.read].filter((f) => !modified.has(f)).sort();
		const modifiedFiles = [...modified].sort();
		const allFiles = [...readFiles, ...modifiedFiles];

		// Build file importance instruction, respecting any user /compact [instructions]
		let combinedInstructions = userInstructions ?? "";

		if (allFiles.length > 0) {
			const fileLines: string[] = [];
			if (modifiedFiles.length > 0) {
				fileLines.push(`Modified:\n${modifiedFiles.map((f) => `  ${f}`).join("\n")}`);
			}
			if (readFiles.length > 0) {
				fileLines.push(`Read-only:\n${readFiles.map((f) => `  ${f}`).join("\n")}`);
			}

			const fileImportanceInstruction = `After all other sections, add:

## Most Important Files
Identify files that are:
- Directly related to accomplishing the goal
- Contain reference code or patterns to follow
- Will need to be read, edited, or created
- Provide important context or constraints

List 3-5 files from those accessed this session, most important first.
One path per line, no bullets, no explanation.

All files accessed this session:
${fileLines.join("\n\n")}`;

			combinedInstructions = combinedInstructions
				? `${combinedInstructions}\n\n${fileImportanceInstruction}`
				: fileImportanceInstruction;
		}

		try {
			const result = await retryWithBackoff(
				() =>
					compact(
						preparation,
						ctx.model,
						apiKey,
						combinedInstructions || undefined,
						signal,
					),
				"compaction",
			);

			if (signal.aborted) return;

			let summary = result.summary;

			// Parse and restructure file sections
			if (allFiles.length > 0) {
				const knownFiles = new Set(allFiles);
				const importantFiles = parseImportantFiles(summary, knownFiles);
				if (importantFiles.length > 0) {
					summary = restructureFileSections(summary, importantFiles, readFiles);
				}
				// If LLM didn't follow the format, summary falls back to default
				// <read-files>/<modified-files> sections untouched
			}

			// Prepend session context block
			const sessionFile = ctx.sessionManager.getSessionFile();
			const leafId = ctx.sessionManager.getLeafId();
			if (sessionFile || leafId) {
				summary = buildSessionContextBlock(sessionFile, leafId) + summary;
			}

			return {
				compaction: {
					summary,
					firstKeptEntryId: result.firstKeptEntryId,
					tokensBefore: result.tokensBefore,
					details: result.details,
				},
			};
		} catch (err) {
			if (!signal.aborted) {
				ctx.ui.notify(
					`pi-compaxxt: compaction failed, using default. ${err instanceof Error ? err.message : String(err)}`,
					"warning",
				);
			}
			return; // fall back to default compaction
		}
	});
}
