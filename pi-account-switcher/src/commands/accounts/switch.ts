import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import type { AccountSwitcherContext } from "@/types";
import { COMMANDS } from "@/constants";
import { commandUtil, errorUtil, providerUtil } from "@/utils";
import { AccountCommand } from "./shared";

export const useSwitchAccountCommand = (pi: ExtensionAPI, runtime: AccountSwitcher) => {
  new SwitchAccountCommand(pi, runtime).register();
};

class SwitchAccountCommand extends AccountCommand {
  constructor(pi: ExtensionAPI, runtime: AccountSwitcher) {
    super(pi, runtime, COMMANDS.accounts.switch);
  }

  async handler(ctx: AccountSwitcherContext): Promise<void> {
    try {
      await this.runtime.load();

      const active = this.runtime.getActiveAccount();
      if (!active) {
        ctx.ui.notify(
          `No active account. Use ${commandUtil.name(COMMANDS.accounts.list.name)} to activate one first.`,
          "info",
        );
        return;
      }

      const providers = this.runtime.getProviders();
      const normalizedActive = providerUtil.normalizeProviderWithCustom(
        active.piAuth?.provider ?? active.provider,
        providers,
      );
      const peers = this.runtime
        .getAccounts()
        .filter(
          (a) =>
            providerUtil.normalizeProviderWithCustom(a.piAuth?.provider ?? a.provider, providers) ===
              normalizedActive && a.id !== active.id,
        );

      if (peers.length === 0) {
        ctx.ui.notify(`No other accounts for provider "${active.provider}".`, "info");
        return;
      }

      const account = await this.pickGroupedAccount(ctx, peers, `Switch account (${active.provider})`);
      if (!account) return;

      const applied = await this.runtime.activateAccount(account, ctx);
      ctx.ui.notify(`Switched to ${account.label} (${applied}).`, "info");
    } catch (e) {
      ctx.ui.notify(`Failed to switch account: ${errorUtil.format(e)}`, "error");
    }
  }
}
