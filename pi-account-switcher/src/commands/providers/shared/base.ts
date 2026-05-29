import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import type { AccountSwitcherContext, ProviderConfig } from "@/types";
import { BaseCommand, type CommandMeta } from "../../base";
import { selectProvider } from ".";

export abstract class ProviderCommand extends BaseCommand {
  constructor(pi: ExtensionAPI, runtime: AccountSwitcher, meta: CommandMeta) {
    super(pi, runtime, meta);
  }

  protected async loadProviders(ctx: AccountSwitcherContext): Promise<ProviderConfig[] | undefined> {
    await this.runtime.load();
    const providers = this.runtime.getProviders();
    if (providers.length === 0) {
      ctx.ui.notify("No custom providers configured.", "info");
      return undefined;
    }
    return providers;
  }

  protected async loadAndSelectProvider(
    ctx: AccountSwitcherContext,
    label: string,
  ): Promise<ProviderConfig | undefined> {
    const providers = await this.loadProviders(ctx);
    if (!providers) return undefined;
    return selectProvider(ctx.ui, label, providers);
  }
}
