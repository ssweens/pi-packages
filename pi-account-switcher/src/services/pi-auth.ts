import { type PiAuthStore, usePiAuthStore, isOAuthEntry } from "@/storage";
import type { PiAuthEntry } from "@/types";

export interface PiAuthService {
  getEntry(provider: string): Promise<PiAuthEntry | undefined>;
  isOAuthEntry(entry: PiAuthEntry | undefined): boolean;
}

export function usePiAuthService(path?: string): PiAuthService {
  return new PiAuthServiceImpl(usePiAuthStore(path));
}

class PiAuthServiceImpl implements PiAuthService {
  constructor(private readonly store: PiAuthStore) {}

  async getEntry(provider: string): Promise<PiAuthEntry | undefined> {
    return this.store.getEntry(provider);
  }

  isOAuthEntry(entry: PiAuthEntry | undefined): boolean {
    return isOAuthEntry(entry);
  }
}
