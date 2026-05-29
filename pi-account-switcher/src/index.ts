import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcherContext } from "@/types";
import { errorUtil, uiUtil } from "@/utils";
import { buildGroupedItems, formatAccountItem } from "@/commands/accounts/shared/select";
import { useAccountSwitcher, type AccountSwitcher } from "./runtime";
import { registerAllCommands } from "./commands";

async function openAccountSelector(runtime: AccountSwitcher, ctx: AccountSwitcherContext): Promise<void> {
  try {
    await runtime.load();
    const accounts = runtime.getAccounts();
    if (accounts.length === 0) {
      ctx.ui.notify("No accounts configured.", "info");
      return;
    }

    const items = buildGroupedItems(accounts, runtime.getProviders(), runtime.getActiveAccount()?.id);
    const labels: string[] = [];
    const values: Array<(typeof accounts)[number] | null> = [];

    for (const item of items) {
      if (item.type === "header") {
        labels.push(item.provider);
        values.push(null);
        continue;
      }

      labels.push(formatAccountItem(item));
      values.push(item.account);
    }

    const account = await uiUtil.filteredGroupedSelect(ctx.ui, "Pick account to activate", labels, values);
    if (!account) return;

    const applied = await runtime.activateAccount(account, ctx);
    ctx.ui.notify(`Switched to ${account.label} (${applied}).`, "info");
  } catch (error) {
    ctx.ui.notify(`Failed to open account selector: ${errorUtil.format(error)}`, "error");
  }
}

async function accountSwitcher(pi: ExtensionAPI) {
  const runtime: AccountSwitcher = useAccountSwitcher(pi);

  pi.on("session_start", async (_, ctx) => {
    await runtime.init(ctx as AccountSwitcherContext);
  });

  pi.on("model_select", async (event, ctx) => {
    await runtime.onModelSelect(event.model.provider, ctx as AccountSwitcherContext);
  });

  registerAllCommands(pi, runtime);

  pi.registerShortcut("ctrl+shift+c", {
    description: "Open account selector",
    handler: async (ctx) => {
      await openAccountSelector(runtime, ctx as AccountSwitcherContext);
    },
  });
}

export default accountSwitcher;
