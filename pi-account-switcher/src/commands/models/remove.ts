import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import type { AccountSwitcherContext } from "@/types";
import { COMMANDS } from "@/constants";
import { errorUtil } from "@/utils";
import { ModelCommand } from "./shared";

export const useRemoveModelCommand = (pi: ExtensionAPI, runtime: AccountSwitcher) => {
  new RemoveModelCommand(pi, runtime).register();
};

class RemoveModelCommand extends ModelCommand {
  constructor(pi: ExtensionAPI, runtime: AccountSwitcher) {
    super(pi, runtime, COMMANDS.models.remove);
  }

  async handler(ctx: AccountSwitcherContext): Promise<void> {
    try {
      const providerConfig = await this.loadProvider(ctx);
      if (!providerConfig) return;

      const removable = (providerConfig.models ?? []).filter((m) => !this.isActiveModel(ctx, m.id, providerConfig.id));
      if (removable.length === 0) {
        ctx.ui.notify(`Provider "${providerConfig.id}" has no removable model configs.`, "info");
        return;
      }

      const model = await this.pick(ctx, "Remove model", removable, (m) => m.name ?? m.id);
      if (!model) return;

      const confirmed = await ctx.ui.confirm("Remove model?", `Remove "${model.id}" from "${providerConfig.id}"?`);
      if (!confirmed) return;

      const updated = { ...providerConfig, models: (providerConfig.models ?? []).filter((m) => m.id !== model.id) };
      await this.runtime.editProvider(providerConfig, updated);
      ctx.ui.notify(`Removed model "${model.id}" from provider "${providerConfig.id}".`, "info");
    } catch (e) {
      ctx.ui.notify(`Failed to remove model: ${errorUtil.format(e)}`, "error");
    }
  }
}
