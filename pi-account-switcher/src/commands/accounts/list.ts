import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import type { AccountSwitcherContext } from "@/types";
import { COMMANDS } from "@/constants";
import { errorUtil } from "@/utils";
import { AccountCommand } from "./shared";

export const useListAccountsCommand = (pi: ExtensionAPI, runtime: AccountSwitcher) => {
  new ListAccountsCommand(pi, runtime).register();
};

class ListAccountsCommand extends AccountCommand {
  constructor(pi: ExtensionAPI, runtime: AccountSwitcher) {
    super(pi, runtime, COMMANDS.accounts.list);
  }

  async handler(ctx: AccountSwitcherContext): Promise<void> {
    try {
      const accounts = await this.loadAccounts(ctx);
      if (!accounts) return;

      const account = await this.pickGroupedAccount(ctx, accounts, "Pick account to activate");
      if (!account) return;

      const applied = await this.runtime.activateAccount(account, ctx);
      ctx.ui.notify(`Switched to ${account.label} (${applied}).`, "info");
    } catch (error) {
      ctx.ui.notify(`Failed to list accounts: ${errorUtil.format(error)}`, "error");
    }
  }
}
