import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import { COMMANDS } from "@/constants";
import { ProviderCommand } from "./shared";
import type { AccountSwitcherContext, ProviderConfig } from "@/types";
import { errorUtil } from "@/utils";

export const useListProvidersCommand = (pi: ExtensionAPI, runtime: AccountSwitcher) => {
  new ListProvidersCommand(pi, runtime).register();
};

class ListProvidersCommand extends ProviderCommand {
  constructor(pi: ExtensionAPI, runtime: AccountSwitcher) {
    super(pi, runtime, COMMANDS.providers.list);
  }

  async handler(ctx: AccountSwitcherContext): Promise<void> {
    try {
      const providers = await this.loadProviders(ctx);
      if (!providers) return;
      await ctx.ui.select(
        "Providers",
        providers.map((p) => this.format(p)),
      );
    } catch (e) {
      ctx.ui.notify(`Failed to list providers: ${errorUtil.format(e)}`, "error");
    }
  }

  private format(p: ProviderConfig): string {
    const details = [
      p.envKeys?.length ? `env: ${p.envKeys.join(", ")}` : undefined,
      p.baseUrl && `baseUrl: ${p.baseUrl}`,
      p.api && `api: ${p.api}`,
      p.models && `models: ${p.models.length}`,
    ]
      .filter(Boolean)
      .join("; ");
    return `custom — ${p.label ?? p.id} (${p.id})${details ? ` ${details}` : ""}`;
  }
}
