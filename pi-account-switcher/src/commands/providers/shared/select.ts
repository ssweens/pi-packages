import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { ProviderConfig } from "@/types";

export async function selectProvider(
  ui: ExtensionUIContext,
  title: string,
  providers: ProviderConfig[],
): Promise<ProviderConfig | undefined> {
  const labelCounts = new Map<string, number>();
  for (const p of providers) {
    labelCounts.set(p.label ?? p.id, (labelCounts.get(p.label ?? p.id) ?? 0) + 1);
  }

  const labelMap = new Map<string, ProviderConfig>();
  for (const p of providers) {
    const base = p.label ?? p.id;
    const display = (labelCounts.get(base) ?? 0) > 1 ? `${base} (${p.id})` : base;
    labelMap.set(display, p);
  }

  const choice = await ui.select(title, [...labelMap.keys()]);
  if (!choice) return undefined;
  return labelMap.get(choice);
}
