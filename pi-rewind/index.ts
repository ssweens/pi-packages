import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, basename } from "path";

/**
 * pi-rewind: Rewind session to a previous point and prune deleted entries.
 *
 * Provides a /rewind command that:
 * 1. Shows a flat list of all user-turn entry points in the session tree
 * 2. User picks a point to rewind to
 * 3. The session navigates to that point (like /tree)
 * 4. The session JSONL file is rewritten to physically remove pruned entries
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SessionEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  [key: string]: unknown;
}

interface SessionHeader {
  type: "session";
  version: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

function parseJSONL(content: string): { header: SessionHeader; entries: SessionEntry[] } {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error("Empty session file");

  const header = JSON.parse(lines[0]) as SessionHeader;
  const entries: SessionEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    entries.push(JSON.parse(lines[i]) as SessionEntry);
  }
  return { header, entries };
}

function serializeJSONL(header: SessionHeader, entries: SessionEntry[]): string {
  const lines = [JSON.stringify(header), ...entries.map((e) => JSON.stringify(e))];
  return lines.join("\n") + "\n";
}

/**
 * Build a set of all entry IDs that must be preserved when rewinding to
 * `targetId`. This includes:
 * - All ancestors of the target (up to root)
 * - The target itself
 * - Any compaction/branch_summary/label entries along the kept path
 *
 * All other entries (i.e. the pruned suffix of the abandoned branch) are removed.
 */
function collectKeptIds(entries: SessionEntry[], targetId: string): Set<string> {
  const entryMap = new Map<string, SessionEntry>();
  for (const e of entries) entryMap.set(e.id, e);

  const kept = new Set<string>();

  // Walk from target up to root, collecting all ancestor IDs
  let current: string | null = targetId;
  while (current !== null) {
    kept.add(current);
    const entry = entryMap.get(current);
    if (!entry) break;
    current = entry.parentId;
  }

  // Also keep entries whose parent is in the kept set but whose own ID
  // is NOT part of a pruned sibling branch. We do this by keeping any entry
  // whose parent chain eventually leads to a kept entry AND whose timestamp
  // is <= the target's timestamp (i.e. it existed at or before the rewind point).
  const targetEntry = entryMap.get(targetId);
  const targetTs = targetEntry?.timestamp ?? "";

  // Keep labels, compactions, branch summaries that reference kept entries
  for (const e of entries) {
    if (e.type === "label" && e.targetId && kept.has(e.targetId as string)) {
      kept.add(e.id);
    }
  }

  return kept;
}

/**
 * Produce a human-readable label for a session entry in the selector list.
 */
function entryLabel(e: SessionEntry, index: number): string {
  const ts = new Date(e.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  if (e.type === "message") {
    const msg = e.message as any;
    const role = msg.role ?? "?";
    let preview = "";

    if (msg.content) {
      if (typeof msg.content === "string") {
        preview = msg.content;
      } else if (Array.isArray(msg.content)) {
        const texts = msg.content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join(" ");
        preview = texts;
      }
    }

    // Truncate long content
    if (preview.length > 80) preview = preview.slice(0, 77) + "…";

    // For tool results, show tool name instead
    if (role === "toolResult") {
      const toolName = msg.toolName ?? "tool";
      preview = `[${toolName}] ${preview}`;
    }

    return `${ts}  ${role.padEnd(12)}  ${preview}`;
  }

  if (e.type === "model_change") return `${ts}  ${"model".padEnd(12)}  ${(e as any).provider}/${(e as any).modelId}`;
  if (e.type === "thinking_level_change") return `${ts}  ${"thinking".padEnd(12)}  level: ${(e as any).thinkingLevel}`;
  if (e.type === "compaction") return `${ts}  ${"compaction".padEnd(12)}  ${(e as any).summary.slice(0, 60)}…`;
  if (e.type === "branch_summary") return `${ts}  ${"branch_sum".padEnd(12)}  ${(e as any).summary.slice(0, 60)}…`;
  if (e.type === "custom") return `${ts}  ${"custom".padEnd(12)}  ${(e as any).customType ?? ""}`;
  if (e.type === "label") return `${ts}  ${"label".padEnd(12)}  ${(e as any).label ?? "(cleared)"}`;
  if (e.type === "session_info") return `${ts}  ${"info".padEnd(12)}  ${(e as any).name ?? ""}`;

  return `${ts}  ${e.type.padEnd(12)}`;
}

// ---------------------------------------------------------------------------
// Extension entry
// ---------------------------------------------------------------------------

export default async function piRewind(pi: ExtensionAPI) {
  pi.registerCommand("rewind", {
    description: "Rewind session to a previous point and permanently delete skipped entries",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const sm = ctx.sessionManager;
      const sessionFile = sm.getSessionFile();

      if (!sessionFile || !existsSync(sessionFile)) {
        ctx.ui.notify("No active session file.", "warning");
        return;
      }

      const allEntries = sm.getEntries();
      const currentLeafId = sm.getLeafId();

      if (allEntries.length === 0) {
        ctx.ui.notify("Session is empty — nothing to rewind.", "info");
        return;
      }

      // Build selectable list: only user messages (the rewind targets)
      // but also show compaction/summary entries for context
      const selectableEntries = allEntries.filter(
        (e) =>
          e.type === "message" &&
          (e as any).message &&
          ((e as any).message.role === "user" || (e as any).message.role === "assistant"),
      );

      if (selectableEntries.length === 0) {
        ctx.ui.notify("No user messages found to rewind to.", "info");
        return;
      }

      // Build labels — newest first so most recent is at top
      const reversed = [...selectableEntries].reverse();
      const labels = reversed.map((e, i) => `${i + 1}. ${entryLabel(e, i)}`);

      const picked = await ctx.ui.select(
        "Rewind to (newest first — skipped entries will be permanently deleted):",
        labels,
        { omitCancel: false },
      );

      if (!picked) return; // cancelled

      const pickedIndex = parseInt(picked.split(".")[0], 10) - 1;
      const targetEntry = reversed[pickedIndex];
      const targetId = targetEntry.id;

      // No-op if already here
      if (targetId === currentLeafId) {
        ctx.ui.notify("Already at this entry.", "info");
        return;
      }

      // Confirm destructive action
      const willDelete = allEntries.filter(
        (e) => e.id !== targetId && e.timestamp > (targetEntry.timestamp as string),
      ).length;

      const confirmMsg = willDelete > 0
        ? `This will permanently delete ${willDelete} entries after the selected point. Continue?`
        : `Rewind to selected entry?`;

      const confirmed = await ctx.ui.confirm(confirmMsg);
      if (!confirmed) return;

      // Navigate the tree (updates in-memory state, fires events, handles summaries)
      const navResult = await ctx.navigateTree(targetId, { summarize: false });

      if (navResult.cancelled) {
        ctx.ui.notify("Rewind cancelled by extension.", "warning");
        return;
      }

      // Prune the JSONL file: remove entries that are no longer reachable
      // from the new leaf position. What we want to keep is the target entry
      // plus all of its ancestors (back to root).
      const freshContent = readFileSync(sessionFile, "utf8");
      const { header, entries } = parseJSONL(freshContent);

      const keptIds = collectKeptIds(entries, targetId);
      const prunedEntries = entries.filter((e) => keptIds.has(e.id));
      const removedCount = entries.length - prunedEntries.length;

      if (removedCount > 0) {
        // Build new fileEntries as JSON strings for atomic write
        const newContent = serializeJSONL(header, prunedEntries);
        writeFileSync(sessionFile, newContent);

        ctx.ui.notify(
          `Rewound to entry ${targetId.slice(0, 8)}. Permanently deleted ${removedCount} entries.`,
          "info",
        );
      } else {
        ctx.ui.notify(`Rewound to entry ${targetId.slice(0, 8)}. No entries to prune.`, "info");
      }
    },
  });
}
