import type { Api, Model } from "@earendil-works/pi-ai";
import type { AccountConfig, AccountSwitcherContext, ProviderConfig } from "@/types";
import { providerUtil } from "./providers";
import { uiUtil } from "./ui";

type ProviderModel = Model<Api>;

export const modelUtil = {
  pickModel: async (
    ctx: AccountSwitcherContext,
    account: AccountConfig,
    providers: ProviderConfig[],
    resolvedProvider?: string,
  ): Promise<ProviderModel | undefined> => {
    const accountProvider =
      resolvedProvider ?? normalizeProvider(account.piAuth?.provider ?? account.provider, providers);
    const candidates = getProviderModels(ctx, providers, accountProvider);

    if (candidates.length === 0) {
      ctx.ui.notify(`Account switched, but no ${accountProvider} models found. Use /model to select one.`, "warning");
      return undefined;
    }

    return (
      resolveConfiguredModel(account, candidates, ctx, accountProvider) ??
      promptForModel(ctx, candidates, accountProvider)
    );
  },
};

function normalizeProvider(provider: string, providers: ProviderConfig[]): string {
  return providerUtil.normalizeProviderWithCustom(provider, providers);
}

function getProviderModels(
  ctx: AccountSwitcherContext,
  providers: ProviderConfig[],
  accountProvider: string,
): ProviderModel[] {
  const seen = new Set<string>();
  const result: ProviderModel[] = [];

  // getAvailable() first so preferred models appear before fallbacks from getAll()
  for (const m of [...ctx.modelRegistry.getAvailable(), ...ctx.modelRegistry.getAll()]) {
    const key = `${m.provider}/${m.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (normalizeProvider(m.provider, providers) === accountProvider) result.push(m);
  }

  return result;
}

function resolveConfiguredModel(
  account: AccountConfig,
  candidates: ProviderModel[],
  ctx: AccountSwitcherContext,
  accountProvider: string,
): ProviderModel | undefined {
  if (account.model) {
    return ctx.modelRegistry.find(accountProvider, account.model) ?? candidates.find((m) => m.id === account.model);
  }
  if (candidates.length === 1) return candidates[0];
  return undefined;
}

async function promptForModel(
  ctx: AccountSwitcherContext,
  candidates: ProviderModel[],
  accountProvider: string,
): Promise<ProviderModel | undefined> {
  const selectedId = await uiUtil.filteredSelect(
    ctx.ui,
    `Select model (${accountProvider})`,
    candidates.map((m) => m.id),
  );
  return candidates.find((m) => m.id === selectedId);
}
