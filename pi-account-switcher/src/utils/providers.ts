import type { ProviderConfig } from "@/types";
import { BUILT_IN_PROVIDER_IDS, PROVIDER_ALIASES, PROVIDER_ENV_KEYS } from "@/constants";

export const providerUtil = {
  normalizeProvider: (value: string): string => {
    const p = value.toLowerCase().trim().replace(/\s+/g, "-");
    return PROVIDER_ALIASES[p] ?? p;
  },

  normalizeProviderWithCustom: (provider: string, customProviders: ProviderConfig[] = []): string => {
    const normalized = providerUtil.normalizeProvider(provider);
    const custom = customProviders.find((candidate) => {
      const names = [candidate.id, ...(candidate.aliases ?? [])].map(providerUtil.normalizeProvider);
      return names.includes(normalized);
    });
    return custom ? providerUtil.normalizeProvider(custom.id) : normalized;
  },

  isBuiltInProviderId: (provider: string): boolean => {
    return BUILT_IN_PROVIDER_IDS.includes(
      providerUtil.normalizeProvider(provider) as (typeof BUILT_IN_PROVIDER_IDS)[number],
    );
  },

  providerChoices: (customProviders: ProviderConfig[] = []): string[] => {
    const customIds = customProviders.map((p) => providerUtil.normalizeProvider(p.id)).sort();
    return [...BUILT_IN_PROVIDER_IDS, ...customIds, "custom"];
  },

  hasProvider: (provider: string, providers: ProviderConfig[]): boolean => {
    return providers.some(
      (c) =>
        providerUtil.normalizeProvider(c.id) === provider ||
        (c.aliases ?? []).map(providerUtil.normalizeProvider).includes(provider),
    );
  },

  findProvider: (provider: string, providers: ProviderConfig[]): ProviderConfig | undefined => {
    const normalized = providerUtil.normalizeProviderWithCustom(provider, providers);
    return providers.find((c) => providerUtil.normalizeProvider(c.id) === normalized);
  },

  requiredEnvKeysForProvider: (provider: string, customProviders: ProviderConfig[] = []): string[] => {
    const custom = providerUtil.findProvider(provider, customProviders);
    return (
      custom?.envKeys ?? PROVIDER_ENV_KEYS[providerUtil.normalizeProviderWithCustom(provider, customProviders)] ?? []
    );
  },
};
