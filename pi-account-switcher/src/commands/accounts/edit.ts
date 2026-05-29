import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import type { AccountSwitcherContext } from "@/types";
import { COMMANDS } from "@/constants";
import { errorUtil } from "@/utils";
import { AccountCommand, AccountConfigBuilder } from "./shared";

export const useEditAccountCommand = (pi: ExtensionAPI, runtime: AccountSwitcher) => {
  new EditAccountCommand(pi, runtime).register();
};

class EditAccountCommand extends AccountCommand {
  constructor(pi: ExtensionAPI, runtime: AccountSwitcher) {
    super(pi, runtime, COMMANDS.accounts.edit);
  }

  async handler(ctx: AccountSwitcherContext): Promise<void> {
    try {
      const original = await this.loadAndSelectAccount(ctx, "Select account to edit");
      if (!original) return;

      const updated = await new AccountConfigBuilder(ctx.ui, this.runtime.getProviders(), original).collect(true);
      if (!updated) return;

      await this.runtime.editAccount(original, updated);
      ctx.ui.notify(`Account "${updated.label}" updated.`, "info");
    } catch (e) {
      ctx.ui.notify(`Failed to edit account: ${errorUtil.format(e)}`, "error");
    }
  }
}
