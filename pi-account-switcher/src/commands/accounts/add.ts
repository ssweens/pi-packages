import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import type { AccountConfig, AccountSwitcherContext } from "@/types";
import { COMMANDS } from "@/constants";
import { errorUtil, providerUtil } from "@/utils";
import { AccountCommand } from "./shared";
import { AccountConfigBuilder } from "./shared/prompts";

export const useAddAccountCommand = (pi: ExtensionAPI, runtime: AccountSwitcher) => {
  new AddAccountCommand(pi, runtime).register();
};

class AddAccountCommand extends AccountCommand {
  constructor(pi: ExtensionAPI, runtime: AccountSwitcher) {
    super(pi, runtime, COMMANDS.accounts.add);
  }

  async handler(ctx: AccountSwitcherContext): Promise<void> {
    try {
      await this.runtime.load();
      const providers = this.runtime.getProviders();

      const account = await new AccountConfigBuilder(ctx.ui, providers).collect();
      if (!account) return;

      await this.saveProvider(ctx, account);
      const saved = await this.saveAccount(ctx, account);
      if (!saved) return;

      ctx.ui.notify(`Added account ${saved.label}.`, "info");

      const activate = await ctx.ui.confirm(
        "Activate now?",
        `Switch ${providerUtil.normalizeProvider(saved.provider)} to ${saved.label} now?`,
      );
      if (activate) {
        const applied = await this.runtime.activateAccount(saved, ctx);
        const detail = applied ? ` (${applied})` : "";
        ctx.ui.notify(`Activated ${saved.label}${detail}.`, "info");
      }
    } catch (error) {
      ctx.ui.notify(`Failed to add account: ${errorUtil.format(error)}`, "error");
    }
  }

  private async saveProvider(ctx: AccountSwitcherContext, account: AccountConfig): Promise<void> {
    const providerId = providerUtil.normalizeProvider(account.provider);

    if (providerUtil.isBuiltInProviderId(providerId)) return;

    if (providerUtil.hasProvider(providerId, this.runtime.getProviders())) return;

    const save = await ctx.ui.confirm(
      "Save custom provider?",
      `Save ${providerId} as a reusable custom provider for future account setup?`,
    );
    if (!save) return;

    const provider = { id: providerId, label: providerId, envKeys: Object.keys(account.env ?? {}) };
    await this.runtime.addProvider(provider);
    ctx.ui.notify(`Saved custom provider ${provider.id}.`, "info");
  }
}
