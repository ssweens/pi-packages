import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import { COMMANDS } from "@/constants";
import type { AccountSwitcherContext } from "@/types";
import { ProviderConfigBuilder, ProviderCommand } from "./shared";
import { errorUtil } from "@/utils";

export const useEditProviderCommand = (pi: ExtensionAPI, runtime: AccountSwitcher) => {
  new EditProviderCommand(pi, runtime).register();
};

class EditProviderCommand extends ProviderCommand {
  constructor(pi: ExtensionAPI, runtime: AccountSwitcher) {
    super(pi, runtime, COMMANDS.providers.edit);
  }

  async handler(ctx: AccountSwitcherContext): Promise<void> {
    try {
      const original = await this.loadAndSelectProvider(ctx, "Select provider to edit");
      if (!original) return;

      const updated = await new ProviderConfigBuilder(ctx.ui, original).collect();
      await this.runtime.editProvider(original, updated);
      ctx.ui.notify(`Provider "${updated.id}" updated.`, "info");
    } catch (e) {
      ctx.ui.notify(`Failed to edit provider: ${errorUtil.format(e)}`, "error");
    }
  }
}
