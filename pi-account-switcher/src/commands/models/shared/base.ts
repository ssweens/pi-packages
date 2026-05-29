import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import type { AccountSwitcherContext, ProviderConfig } from "@/types";
import { BaseCommand, type CommandMeta } from "../../base";
import { providerUtil } from "@/utils";
import type { ProviderModel } from "./select";

export abstract class ModelCommand extends BaseCommand {
  constructor(pi: ExtensionAPI, runtime: AccountSwitcher, meta: CommandMeta) {
    super(pi, runtime, meta);
  }

  protected async loadProvider(ctx: AccountSwitcherContext): Promise<ProviderConfig | undefined> {
    await this.runtime.load();

    // Prefer the active account's provider so that switching to an account whose
    // provider has no models yet still targets the correct (new) provider.
    const activeAccount = this.runtime.getActiveAccount();
    const providers = this.runtime.getProviders();
    const provider = activeAccount?.provider ?? ctx.model?.provider;
    if (!provider) {
      ctx.ui.notify("No active model. Use models:list to select one first.", "info");
      return undefined;
    }

    const config = providerUtil.findProvider(provider, providers);
    if (!config) {
      ctx.ui.notify(`"${provider}" is a built-in provider. This command only works with custom providers.`, "info");
      return undefined;
    }

    return config;
  }

  protected getModels(ctx: AccountSwitcherContext, provider: string): ProviderModel[] {
    const providers = this.runtime.getProviders();
    const normalized = providerUtil.normalizeProviderWithCustom(provider, providers);
    const seen = new Set<string>();
    const result: ProviderModel[] = [];
    for (const m of [...ctx.modelRegistry.getAvailable(), ...ctx.modelRegistry.getAll()]) {
      const key = `${m.provider}/${m.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (providerUtil.normalizeProviderWithCustom(m.provider, providers) === normalized) result.push(m);
    }
    return result;
  }
}
