import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import type { AccountSwitcherContext } from "@/types";
import { COMMANDS } from "@/constants";
import { errorUtil } from "@/utils";
import { ModelCommand, ModelConfigBuilder } from "./shared";

export const useAddModelCommand = (pi: ExtensionAPI, runtime: AccountSwitcher) => {
  new AddModelCommand(pi, runtime).register();
};

class AddModelCommand extends ModelCommand {
  constructor(pi: ExtensionAPI, runtime: AccountSwitcher) {
    super(pi, runtime, COMMANDS.models.add);
  }

  async handler(ctx: AccountSwitcherContext): Promise<void> {
    try {
      const providerConfig = await this.loadProvider(ctx);
      if (!providerConfig) return;

      const model = await new ModelConfigBuilder(ctx.ui).collect();
      const updated = { ...providerConfig, models: [...(providerConfig.models ?? []), model] };
      await this.runtime.editProvider(providerConfig, updated);
      ctx.ui.notify(`Added model "${model.id}" to provider "${providerConfig.id}".`, "info");
    } catch (e) {
      ctx.ui.notify(`Failed to add model: ${errorUtil.format(e)}`, "error");
    }
  }
}
