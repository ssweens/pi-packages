import type { Api, Model } from "@earendil-works/pi-ai";
import type { ProviderConfig } from "@/types";
import { providerUtil } from "@/utils";

export type ProviderModel = Model<Api>;

export type ModelItem = { type: "header"; provider: string } | { type: "model"; model: ProviderModel; active: boolean };

export function buildGroupedModelItems(
  models: ProviderModel[],
  providers: ProviderConfig[],
  activeId: string | undefined,
): ModelItem[] {
  const sorted = [...models].sort((a, b) => {
    const pa = providerUtil.normalizeProviderWithCustom(a.provider, providers);
    const pb = providerUtil.normalizeProviderWithCustom(b.provider, providers);
    return pa.localeCompare(pb) || a.id.localeCompare(b.id);
  });

  const items: ModelItem[] = [];
  let prevProvider: string | undefined;

  for (const model of sorted) {
    const provider = providerUtil.normalizeProviderWithCustom(model.provider, providers);
    if (prevProvider !== provider) {
      items.push({ type: "header", provider });
      prevProvider = provider;
    }
    items.push({ type: "model", model, active: model.id === activeId });
  }
  return items;
}

export function formatModelItem(item: Extract<ModelItem, { type: "model" }>): string {
  const marker = item.active ? "✓" : "·";
  return `    ${marker} ${item.model.id}`;
}
