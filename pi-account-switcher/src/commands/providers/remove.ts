import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import { COMMANDS } from "@/constants";
import type { AccountSwitcherContext } from "@/types";
import { errorUtil, providerUtil } from "@/utils";
import { ProviderCommand, selectProvider } from "./shared";

export const useRemoveProviderCommand = (pi: ExtensionAPI, runtime: AccountSwitcher) => {
  new RemoveProviderCommand(pi, runtime).register();
};

class RemoveProviderCommand extends ProviderCommand {
  constructor(pi: ExtensionAPI, runtime: AccountSwitcher) {
    super(pi, runtime, COMMANDS.providers.remove);
  }

  async handler(ctx: AccountSwitcherContext): Promise<void> {
    try {
      const providers = await this.loadProviders(ctx);
      if (!providers) return;

      const accounts = this.runtime.getAccounts();
      const removable = providers.filter(
        (p) => !accounts.some((a) => providerUtil.normalizeProviderWithCustom(a.provider, providers) === p.id),
      );
      if (removable.length === 0) {
        ctx.ui.notify("No providers to remove.", "info");
        return;
      }

      const provider = await selectProvider(ctx.ui, "Remove provider", removable);
      if (!provider) return;

      const confirmed = await ctx.ui.confirm(
        "Remove provider?",
        `Remove "${provider.label ?? provider.id}" (${provider.id})?`,
      );
      if (!confirmed) return;

      await this.runtime.removeProvider(provider);
      ctx.ui.notify(`Removed provider "${provider.label ?? provider.id}".`, "info");
    } catch (e) {
      ctx.ui.notify(`Failed to remove provider: ${errorUtil.format(e)}`, "error");
    }
  }
}
