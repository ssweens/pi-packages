import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import type { AccountConfig, AccountSwitcherContext } from "@/types";
import { COMMANDS, OAUTH_PROVIDER_IDS, PI_AUTH_PATH } from "@/constants";
import { commonUtil, errorUtil } from "@/utils";
import { AccountCommand } from "./shared";

export const useOAuthImportCommand = (pi: ExtensionAPI, runtime: AccountSwitcher) => {
  new OAuthImportCommand(pi, runtime).register();
};

class OAuthImportCommand extends AccountCommand {
  constructor(pi: ExtensionAPI, runtime: AccountSwitcher) {
    super(pi, runtime, COMMANDS.accounts.oauth);
  }

  async handler(ctx: AccountSwitcherContext): Promise<void> {
    try {
      await this.runtime.load();

      const providerChoice = await ctx.ui.select("Provider logged in with Pi /login", [...OAUTH_PROVIDER_IDS]);
      if (!providerChoice) return;

      const provider =
        providerChoice === "custom"
          ? (await ctx.ui.input("Pi auth provider id", "provider-id"))?.trim()
          : providerChoice;
      if (!provider) return;

      const entry = await this.runtime.getPiAuthEntry(provider);
      if (!entry) {
        ctx.ui.notify(`No Pi auth entry for "${provider}". Run /login ${provider} first, then try again.`, "error");
        return;
      }

      if (!this.runtime.isOAuthEntry(entry)) {
        const ok = await ctx.ui.confirm(
          "Import non-OAuth auth entry?",
          `"${provider}" exists in ${PI_AUTH_PATH} but is not marked as OAuth. Import anyway?`,
        );
        if (!ok) return;
      }

      const label = (await ctx.ui.input("Account label", `${provider} — Work`))?.trim();
      if (!label) return;

      const suggested = commonUtil.slugify(label);
      const id = (await ctx.ui.input("Account id", suggested))?.trim() || suggested;

      const account: AccountConfig = { id, label, provider, piAuth: { provider, entry } };
      const saved = await this.saveAccount(ctx, account);
      if (!saved) return;

      ctx.ui.notify(`Imported OAuth account "${saved.label}".`, "info");
    } catch (error) {
      ctx.ui.notify(`Failed to import OAuth account: ${errorUtil.format(error)}`, "error");
    }
  }
}
