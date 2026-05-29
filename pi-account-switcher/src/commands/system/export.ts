import { readFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import { COMMANDS, DEFAULT_EXPORT_PATH, STATE_PATH } from "@/constants";
import type { AccountSwitcherContext } from "@/types";
import { BaseCommand } from "../base";
import { errorUtil, fileUtil } from "@/utils";

export const useExportCommand = (pi: ExtensionAPI, runtime: AccountSwitcher) => {
  new ExportCommand(pi, runtime).register();
};

class ExportCommand extends BaseCommand {
  constructor(pi: ExtensionAPI, runtime: AccountSwitcher) {
    super(pi, runtime, COMMANDS.system.export);
  }

  async handler(ctx: AccountSwitcherContext, args?: string): Promise<void> {
    try {
      const target = args?.trim() || (await ctx.ui.input("Export file (blank for default)", DEFAULT_EXPORT_PATH));
      if (target === undefined) {
        ctx.ui.notify("Export cancelled.", "info");
        return;
      }

      const state = await loadState();
      const exportData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        accounts: this.runtime.getAccounts(),
        providers: this.runtime.getProviders(),
        state,
      };

      const path = fileUtil.expandHome(target.trim() || DEFAULT_EXPORT_PATH);
      await fileUtil.writePrivateJson(path, exportData);
      ctx.ui.notify(`Exported account switcher data to ${path}.`, "info");
    } catch (e) {
      ctx.ui.notify(`Failed to export: ${errorUtil.format(e)}`, "error");
    }
  }
}

async function loadState(): Promise<unknown> {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf8"));
  } catch (error) {
    if (fileUtil.isMissingFileError(error)) return {};
    throw error;
  }
}
