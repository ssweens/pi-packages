import * as piAi from "@earendil-works/pi-ai";
import { readFile } from "node:fs/promises";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { AccountConfig, SecretSource } from "@/types";
import { commonUtil } from "./common";
import { fileUtil } from "./files";
import { providerUtil } from "./providers";

export const accountUtil = {
  clearAccountEnv: async (account: AccountConfig, modelRegistry?: ModelRegistry): Promise<void> => {
    const authProvider = account.piAuth?.provider ?? providerUtil.normalizeProvider(account.provider);
    if (!account.piAuth && account.env) {
      for (const envName of Object.keys(account.env)) {
        delete process.env[envName];
      }
    }
    modelRegistry?.authStorage.removeRuntimeApiKey(authProvider);
  },

  applyAccountEnv: async (
    account: AccountConfig,
    modelRegistry?: ModelRegistry,
    authProviderOverride?: string,
  ): Promise<string[]> => {
    if (account.piAuth) {
      const authProvider = authProviderOverride ?? account.piAuth.provider;
      modelRegistry?.authStorage.set(authProvider, account.piAuth.entry);
      modelRegistry?.authStorage.reload();
      closeCachedSessions();
      return [];
    }

    const resolved = await accountUtil.resolveAccountEnv(account);
    return accountUtil.applyResolvedAccountEnv(account, resolved, modelRegistry, authProviderOverride);
  },

  resolveAccountEnv: async (account: AccountConfig): Promise<Array<[string, string]>> => {
    if (!account.env) return [];

    const resolvedEntries: Array<[string, string]> = [];
    for (const [envName, source] of Object.entries(account.env)) {
      const value = await accountUtil.resolveSecret(source);
      if (!value) throw new Error(`Resolved empty value for ${envName} in account ${account.id}`);
      resolvedEntries.push([envName, value]);
    }
    return resolvedEntries;
  },

  applyResolvedAccountEnv: (
    account: AccountConfig,
    resolvedEntries: Array<[string, string]>,
    modelRegistry?: ModelRegistry,
    authProviderOverride?: string,
  ): string[] => {
    const authProvider = authProviderOverride ?? providerUtil.normalizeProvider(account.provider);
    const applied: string[] = [];
    for (const [envName, value] of resolvedEntries) {
      process.env[envName] = value;
      applied.push(envName);
    }

    const firstValue = resolvedEntries[0]?.[1];
    if (firstValue) modelRegistry?.authStorage.setRuntimeApiKey(authProvider, firstValue);
    else modelRegistry?.authStorage.removeRuntimeApiKey(authProvider);

    return applied;
  },

  resolveSecret: async (source: SecretSource): Promise<string> => {
    if (typeof source === "string") {
      if (source.startsWith("op://")) return commonUtil.runOpRead(source);
      return source;
    }
    switch (source.type) {
      case "literal":
        return source.value;
      case "env": {
        const value = process.env[source.name];
        if (!value) throw new Error(`Environment variable ${source.name} is not set`);
        return value;
      }
      case "file":
        return (await readFile(fileUtil.expandHome(source.path), "utf8")).trim();
      case "command":
        return commonUtil.runCommand(source.command);
      case "op":
        return commonUtil.runOpRead(source.reference);
    }
  },
};

function closeCachedSessions(): void {
  const helpers = piAi as {
    cleanupSessionResources?: () => void;
    closeOpenAICodexWebSocketSessions?: () => void;
  };
  helpers.cleanupSessionResources?.();
  helpers.closeOpenAICodexWebSocketSessions?.();
}
