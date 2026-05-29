import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const fileUtil = {
  isMissingFileError: (error: unknown): boolean => {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
  },

  expandHome: (path: string): string => {
    if (path === "~" || path.startsWith("~/")) {
      const home = process.env.HOME;
      if (!home) throw new Error("HOME environment variable is not set");
      return path === "~" ? home : `${home}${path.slice(1)}`;
    }
    return path;
  },

  writePrivateJson: async (path: string, value: unknown): Promise<void> => {
    const dir = dirname(path);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(path, 0o600);
  },
};
