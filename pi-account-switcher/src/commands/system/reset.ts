import { rm } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import { ACCOUNTS_PATH, COMMANDS, PROVIDERS_PATH, STATE_PATH } from "@/constants";
import type { AccountSwitcherContext } from "@/types";
import { BaseCommand } from "../base";
import { errorUtil, uiUtil } from "@/utils";

export const useResetCommand = (pi: ExtensionAPI, runtime: AccountSwitcher) => {
  new ResetCommand(pi, runtime).register();
};

class ResetCommand extends BaseCommand {
  constructor(pi: ExtensionAPI, runtime: AccountSwitcher) {
    super(pi, runtime, COMMANDS.system.reset);
  }

  async handler(ctx: AccountSwitcherContext): Promise<void> {
    try {
      const confirmed = await ctx.ui.confirm(
        "Reset all extension data?",
        "This will permanently delete all accounts, providers, and state. This cannot be undone.",
      );
      if (!confirmed) return;

      await Promise.all([ACCOUNTS_PATH, PROVIDERS_PATH, STATE_PATH].map((path) => rm(path, { force: true })));

      await this.runtime.load();
      uiUtil.setAccountStatus(ctx.ui, undefined);

      ctx.ui.notify("Extension data reset to factory defaults.", "info");
    } catch (e) {
      ctx.ui.notify(`Failed to reset: ${errorUtil.format(e)}`, "error");
    }
  }
}
