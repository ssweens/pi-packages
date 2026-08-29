import { completeSimple } from "@mariozechner/pi-ai";
import * as fs from "node:fs/promises";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { PiOmpConfig } from "../src/config";
import { COMMIT_SYSTEM } from "../src/prompts";

const CONVENTIONAL = /^[a-z0-9]+(\([a-z0-9-]+\))?[!]?: /;

async function run(pi: ExtensionAPI, args: string[], cwd: string): Promise<string> {
	const r = await pi.exec("git", args, { cwd });
	return r.stdout.trim();
}

async function proposeMessage(ctx: ExtensionCommandContext, diff: string): Promise<string | undefined> {
	if (!ctx.model) return undefined;
	try {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
		if (!auth.ok) return undefined;
		const result = await completeSimple(
			ctx.model,
			{
				systemPrompt: COMMIT_SYSTEM,
				messages: [{ role: "user", content: `Staged diff:\n\n${diff}`, timestamp: Date.now() }],
			},
			{
				apiKey: auth.apiKey,
				headers: auth.headers,
				timeoutMs: 30000,
			},
		);
		return result.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("")
			.trim();
	} catch {
		return undefined;
	}
}

export function installCommit(pi: ExtensionAPI, cfg: PiOmpConfig): void {
	pi.registerCommand("commit", {
		description:
			"Generate and commit staged changes with a conventional message. /commit [--commit] [--push]. Dry-run by default.",
		handler: async (args, ctx) => {
			const flags = args.split(/\s+/);
			const doCommit = flags.includes("--commit");
			const doPush = flags.includes("--push");
			const cwd = ctx.cwd;

			const shortStat = await run(pi, ["diff", "--cached", "--stat"], cwd);
			const nameStatus = await run(pi, ["diff", "--cached", "--name-only"], cwd);
			if (!shortStat) {
				ctx.ui.notify("No staged changes (git diff --cached is empty).", "warning");
				return;
			}

			const fullDiff = await run(pi, ["diff", "--cached"], cwd);
			let subject = (await proposeMessage(ctx, fullDiff)) ?? "";
			if (!CONVENTIONAL.test(subject)) {
				// Fallback heuristic: type from the first changed path, scope from top dir.
				const firstFile = nameStatus.split("\n")[0] ?? "";
				const top = firstFile.split("/")[0] ?? "";
				const type = /test|spec|\.test\./i.test(firstFile) ? "test" : top === "docs" ? "docs" : "feat";
				subject = `${type}${top ? `(${top})` : ""}: update ${firstFile}`;
			}
			const conventional = CONVENTIONAL.test(subject);

			ctx.ui.setWidget("pi-omp.commit", subject.split("\n"));
			if (!doCommit && cfg.commit.dryRun) {
				ctx.ui.notify(
					`Conventional: ${conventional ? "yes" : "no (using heuristic)"}. Run /commit --commit to commit.`,
					"info",
				);
				return;
			}

			const ok = await ctx.ui.confirm("Commit these changes?", subject);
			if (!ok) {
				ctx.ui.notify("Aborted (not committed).", "warning");
				return;
			}
			const msgFile = `/tmp/pi-omp-commit-${process.pid}-${Date.now()}.txt`;
			await fs.writeFile(msgFile, subject + "\n", "utf8");
			const commit = await pi.exec("git", ["commit", "-F", msgFile], { cwd });
			if (commit.code !== 0) {
				ctx.ui.notify(`Commit failed: ${commit.stderr || "unknown error"}`, "error");
				return;
			}
			ctx.ui.notify("Committed.", "info");
			if (doPush) {
				const push = await pi.exec("git", ["push"], { cwd });
				ctx.ui.notify(
					push.code === 0 ? "Pushed." : `Push failed: ${push.stderr || "unknown error"}`,
					push.code === 0 ? "info" : "error",
				);
			}
		},
	});
}
