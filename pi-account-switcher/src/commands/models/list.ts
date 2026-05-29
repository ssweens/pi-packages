import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import type { AccountSwitcherContext } from "@/types";
import { COMMANDS } from "@/constants";
import { errorUtil, providerUtil } from "@/utils";
import { ModelCommand } from "./shared";

export const useListModelsCommand = (pi: ExtensionAPI, runtime: AccountSwitcher) => {
  new ListModelsCommand(pi, runtime).register();
};

class ListModelsCommand extends ModelCommand {
  constructor(pi: ExtensionAPI, runtime: AccountSwitcher) {
    super(pi, runtime, COMMANDS.models.list);
  }

  async handler(ctx: AccountSwitcherContext): Promise<void> {
    try {
      await this.runtime.load();

      const providers = this.runtime.getProviders();
      const activeAccount = this.runtime.getActiveAccount();
      const activeProvider =
        activeAccount?.piAuth?.provider ??
        (activeAccount
          ? (providerUtil.findProvider(activeAccount.provider, providers)?.piAuthProvider ?? activeAccount.provider)
          : undefined);
      const provider = activeProvider ?? ctx.model?.provider;
      if (!provider) {
        ctx.ui.notify("No active account or model.", "info");
        return;
      }

      const models = this.getModels(ctx, provider);
      if (models.length === 0) {
        ctx.ui.notify(`No models available for provider "${provider}".`, "info");
        return;
      }

      const normalizedProvider = providerUtil.normalizeProviderWithCustom(provider, providers);
      const currentBelongsToProvider =
        ctx.model && providerUtil.normalizeProviderWithCustom(ctx.model.provider, providers) === normalizedProvider;
      const currentId = currentBelongsToProvider ? ctx.model?.id : undefined;
      const model = await this.pick(ctx, `Models (${normalizedProvider})`, models, (m) =>
        m.id === currentId ? `${m.id} ✓` : m.id,
      );
      if (!model) return;

      await this.runtime.applyModel(model, ctx);
      ctx.ui.notify(`Switched to ${model.id}.`, "info");
    } catch (e) {
      ctx.ui.notify(`Failed to list models: ${errorUtil.format(e)}`, "error");
    }
  }
}
