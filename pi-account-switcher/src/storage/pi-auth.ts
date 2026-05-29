import { readFile } from "node:fs/promises";
import { PI_AUTH_PATH } from "@/constants";
import type { PiAuthEntry } from "@/types";
import { fileUtil } from "@/utils";

type PiAuthFile = Record<string, PiAuthEntry>;

export interface PiAuthStore {
  getEntry(provider: string): Promise<PiAuthEntry | undefined>;
}

export function usePiAuthStore(path = PI_AUTH_PATH): PiAuthStore {
  return new PiAuthStoreImpl(path);
}

export function isOAuthEntry(entry: PiAuthEntry | undefined): boolean {
  return entry?.type === "oauth";
}

class PiAuthStoreImpl implements PiAuthStore {
  constructor(private readonly path: string) {}

  async getEntry(provider: string): Promise<PiAuthEntry | undefined> {
    const auth = await this.load();
    return auth[provider];
  }

  private async load(): Promise<PiAuthFile> {
    try {
      const raw = await readFile(this.path, "utf8");
      return JSON.parse(raw) as PiAuthFile;
    } catch (error) {
      if (fileUtil.isMissingFileError(error)) return {};
      throw error;
    }
  }
}
