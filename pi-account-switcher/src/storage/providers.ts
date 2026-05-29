import type { ProviderConfig } from "@/types";
import { commonUtil, errorUtil, fileUtil, providerUtil } from "@/utils";
import { readFile } from "node:fs/promises";
import { providerCatalogArraySchema, providerCatalogRecordSchema } from "@/schemas";

export interface ProviderStore {
  load(): Promise<ProviderConfig[]>;
  save(providers: ProviderConfig[]): Promise<void>;
}

export function useProviderStore(path: string) {
  return new ProviderStoreImpl(path);
}

// ===============================================================================================
// Provider Store
// ===============================================================================================

class ProviderStoreImpl implements ProviderStore {
  constructor(private readonly path: string) {}

  async save(providers: ProviderConfig[]): Promise<void> {
    await fileUtil.writePrivateJson(this.path, { providers });
  }

  async load(): Promise<ProviderConfig[]> {
    try {
      const raw = await readFile(this.path, "utf8");
      const json = JSON.parse(raw) as unknown;
      const result = providerCatalogRecordSchema.safeParse(json);
      if (result.success) return JsonParser.parseRecord(result.data.providers);

      const arrayResult = providerCatalogArraySchema.safeParse(json);
      if (arrayResult.success) return JsonParser.parseArray(arrayResult.data.providers);

      throw new Error("providers.json must contain either a providers object or providers array");
    } catch (error) {
      if (fileUtil.isMissingFileError(error)) {
        return [];
      }
      throw new Error(`Failed to load account switcher providers at ${this.path}: ${errorUtil.format(error)}`);
    }
  }
}

// ===============================================================================================
// Json Parser
// ===============================================================================================

type ProviderRecord = Record<string, Omit<ProviderConfig, "id"> & { id?: string }>;

class JsonParser {
  static parseRecord(providers: ProviderRecord): ProviderConfig[] {
    return Object.entries(providers).map(([id, provider]) => this.normalize({ ...provider, id } as ProviderConfig));
  }

  static parseArray(providers: ProviderConfig[]): ProviderConfig[] {
    return providers.map((provider) => this.normalize(provider));
  }

  private static normalize(provider: ProviderConfig): ProviderConfig {
    const id = providerUtil.normalizeProvider(provider.id);

    const envKeys = commonUtil.unique([
      ...(provider.envKeys ?? []),
      ...(provider.apiKey && commonUtil.isLikelyEnvKey(provider.apiKey) ? [provider.apiKey] : []),
    ]);

    const aliases = commonUtil
      .unique((provider.aliases ?? []).map(providerUtil.normalizeProvider))
      .filter((alias) => alias !== id);

    const api =
      provider.api ?? (provider.baseUrl || provider.apiKey || provider.models ? "openai-completions" : undefined);

    return {
      ...provider,
      id,
      label: provider.label ?? provider.name,
      api,
      aliases,
      envKeys,
    };
  }
}
