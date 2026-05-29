import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import type { AccountSwitcherContext } from "@/types";
import { COMMANDS } from "@/constants";
import { errorUtil } from "@/utils";
import { AccountCommand } from "./shared";

export const useRemoveAccountCommand = (pi: ExtensionAPI, runtime: AccountSwitcher) => {
  new RemoveAccountCommand(pi, runtime).register();
};

class RemoveAccountCommand extends AccountCommand {
  constructor(pi: ExtensionAPI, runtime: AccountSwitcher) {
    super(pi, runtime, COMMANDS.accounts.remove);
  }

  async handler(ctx: AccountSwitcherContext): Promise<void> {
    try {
      const accounts = await this.loadAccounts(ctx);
      if (!accounts) return;

      const removable = accounts.filter((a) => !this.isActiveAccount(a));
      if (removable.length === 0) {
        ctx.ui.notify("No removable accounts. Switch to another account first.", "info");
        return;
      }

      const account = await this.pickGroupedAccount(ctx, removable, "Select account to remove");
      if (!account) return;

      const confirmed = await ctx.ui.confirm("Remove account?", `"${account.label}" will be permanently removed.`);
      if (!confirmed) return;

      await this.runtime.removeAccount(account);
      ctx.ui.notify(`Account "${account.label}" removed.`, "info");
    } catch (e) {
      ctx.ui.notify(`Failed to remove account: ${errorUtil.format(e)}`, "error");
    }
  }
}
