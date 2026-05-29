import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export const commonUtil = {
  unique: (values: string[]): string[] => {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  },

  isLikelyEnvKey: (value: string): boolean => {
    return /^[A-Z][A-Z0-9_]*$/.test(value);
  },

  omitUndefined: <T extends Record<string, unknown>>(value: T): T => {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
  },

  parseCsv: (value: string): string[] => {
    return [
      ...new Set(
        value
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean),
      ),
    ];
  },

  blankToUndefined: (value: string | undefined): string | undefined => {
    const trimmed = value?.trim();
    return trimmed || undefined;
  },

  parseJsonArray: (value: string | undefined, field: string): unknown[] | undefined => {
    const trimmed = value?.trim();
    if (!trimmed) return undefined;
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) throw new Error(`${field} must be a JSON array`);
    return parsed;
  },

  parseJsonRecord: (value: string | undefined, field: string): Record<string, unknown> | undefined => {
    const trimmed = value?.trim();
    if (!trimmed) return undefined;
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error(`${field} must be a JSON object`);
    return parsed as Record<string, unknown>;
  },

  slugify: (value: string): string => {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  },

  runCommand: async (command: string): Promise<string> => {
    const { stdout } = await execAsync(command, { timeout: 15_000, maxBuffer: 1024 * 1024, env: process.env });
    return stdout.trim();
  },

  runOpRead: async (reference: string): Promise<string> => {
    const { stdout } = await execFileAsync("op", ["read", reference], {
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
      env: process.env,
    });
    return stdout.trim();
  },

  runWithConcurrency: async <T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> => {
    const results = new Array<R>(items.length);
    let nextIndex = 0;

    const runNext = async (): Promise<void> => {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
      await runNext();
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runNext));
    return results;
  },
};
