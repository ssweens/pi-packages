import type { AccountConfig, ProviderConfig } from "@/types";
import { providerUtil } from "@/utils";

export type GroupedAccountItem =
  | { type: "header"; provider: string }
  | { type: "account"; account: AccountConfig; provider: string; active: boolean };

export function buildGroupedItems(
  accounts: AccountConfig[],
  providers: ProviderConfig[],
  activeId: string | undefined,
): GroupedAccountItem[] {
  const sorted = [...accounts].sort((a, b) => {
    const pa = providerUtil.normalizeProviderWithCustom(a.provider, providers);
    const pb = providerUtil.normalizeProviderWithCustom(b.provider, providers);
    return pa.localeCompare(pb) || a.label.localeCompare(b.label);
  });

  const items: GroupedAccountItem[] = [];
  let previousProvider: string | undefined;

  for (const account of sorted) {
    const provider = providerUtil.normalizeProviderWithCustom(account.provider, providers);
    if (previousProvider !== provider) {
      items.push({ type: "header", provider });
      previousProvider = provider;
    }
    items.push({ type: "account", account, provider, active: account.id === activeId });
  }

  return items;
}

export function formatAccountItem(item: Extract<GroupedAccountItem, { type: "account" }>): string {
  const marker = item.active ? "✓" : "·";
  return `    ${marker} ${item.account.label}`;
}
