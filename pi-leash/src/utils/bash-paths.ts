/**
 * AST-based bash path extraction.
 *
 * Parses a bash command string and extracts path-like candidates as absolute
 * paths. Uses command-aware argument classification to avoid false positives
 * from regex patterns, inline code, and option values.
 *
 * Falls back to regex tokenization when AST parsing fails.
 */

import { resolve } from "node:path";
import { parse } from "../vendor/aliou-sh/index.js";
import { classifyCommandArgs } from "./command-args";
import { expandGlob, hasGlobChars } from "./glob-expander";
import { expandHomePath, maybePathLike } from "./path";
import { walkCommands, wordToString } from "./shell-utils";

async function expandCandidate(
  candidate: string,
  cwd: string,
): Promise<string[]> {
  if (!hasGlobChars(candidate)) return [candidate];
  const matches = await expandGlob(candidate, { cwd });
  return matches.length > 0 ? matches : [candidate];
}

/**
 * Extract path-like candidates from a bash command string.
 * Returns absolute paths. Best-effort: uses AST parsing with regex fallback.
 * Does NOT filter by any policy — returns all path-like arguments.
 */
export async function extractBashPathCandidates(
  command: string,
  cwd: string,
): Promise<string[]> {
  const seen = new Set<string>();
  const results: string[] = [];

  const addCandidate = async (
    token: string,
    forcePath = false,
  ): Promise<void> => {
    if (!token || token.startsWith("-")) return;
    if (!forcePath && !maybePathLike(token)) return;

    const expanded = await expandCandidate(token, cwd);
    for (const file of expanded) {
      const abs = resolve(cwd, expandHomePath(file));
      if (!seen.has(abs)) {
        seen.add(abs);
        results.push(abs);
      }
    }
  };

  try {
    const { ast } = parse(command);
    const pending: Promise<void>[] = [];

    walkCommands(ast, (cmd) => {
      const words = (cmd.words ?? []).map(wordToString);
      const commandName = words[0];
      if (commandName) {
        for (const arg of classifyCommandArgs(commandName, words.slice(1))) {
          pending.push(addCandidate(arg.token, arg.forcePath));
        }
      }
      for (const redir of cmd.redirects ?? []) {
        pending.push(addCandidate(wordToString(redir.target), true));
      }
      return false;
    });

    await Promise.all(pending);
    return results;
  } catch {
    // Fallback: regex tokenization
    const tokenRegex = /"([^"]+)"|'([^']+)'|`([^`]+)`|([^\s"'`<>|;&]+)/g;
    for (const match of command.matchAll(tokenRegex)) {
      const token = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
      if (token && !token.startsWith("-") && maybePathLike(token)) {
        const expanded = await expandCandidate(token, cwd);
        for (const file of expanded) {
          const abs = resolve(cwd, expandHomePath(file));
          if (!seen.has(abs)) {
            seen.add(abs);
            results.push(abs);
          }
        }
      }
    }
    return results;
  }
}
