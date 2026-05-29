import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import { COMMANDS } from "@/constants";
import type { AccountSwitcherContext } from "@/types";
import { ProviderConfigBuilder } from "./shared";
import { BaseCommand } from "../base";
import { errorUtil } from "@/utils";

export const useAddProviderCommand = (pi: ExtensionAPI, runtime: AccountSwitcher) => {
  new AddProviderCommand(pi, runtime).register();
};

class AddProviderCommand extends BaseCommand {
  constructor(pi: ExtensionAPI, runtime: AccountSwitcher) {
    super(pi, runtime, COMMANDS.providers.add);
  }

  async handler(ctx: AccountSwitcherContext): Promise<void> {
    try {
      await this.runtime.load();
      const provider = await new ProviderConfigBuilder(ctx.ui).collect();
      await this.runtime.addProvider(provider);
      ctx.ui.notify(`Provider "${provider.id}" added.`, "info");
    } catch (e) {
      ctx.ui.notify(`Failed to add provider: ${errorUtil.format(e)}`, "error");
    }
  }
}
