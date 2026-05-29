import { readFile } from "node:fs/promises";
import z from "zod";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import { ACCOUNTS_PATH, COMMANDS, DEFAULT_EXPORT_PATH, PROVIDERS_PATH, STATE_PATH } from "@/constants";
import { accountSchema, providerSchema } from "@/schemas";
import type { AccountConfig, AccountSwitcherContext, ProviderConfig } from "@/types";
import { BaseCommand } from "../base";
import { errorUtil, fileUtil, uiUtil } from "@/utils";

const importStateSchema = z
  .object({
    activeAccountId: z.string().optional(),
    activeModelId: z.string().optional(),
    activeModelProvider: z.string().optional(),
  })
  .default({});

const exportBundleSchema = z.object({
  version: z.number().optional(),
  accounts: z.array(accountSchema).default([]),
  providers: z.array(providerSchema.extend({ id: z.string().min(1) })).default([]),
  state: importStateSchema,
});

type ImportBundle = {
  accounts: AccountConfig[];
  providers: ProviderConfig[];
  state: z.infer<typeof importStateSchema>;
};

export const useImportCommand = (pi: ExtensionAPI, runtime: AccountSwitcher) => {
  new ImportCommand(pi, runtime).register();
};

class ImportCommand extends BaseCommand {
  constructor(pi: ExtensionAPI, runtime: AccountSwitcher) {
    super(pi, runtime, COMMANDS.system.import);
  }

  async handler(ctx: AccountSwitcherContext, args?: string): Promise<void> {
    try {
      const source = args?.trim() || (await ctx.ui.input("Import file (blank for default)", DEFAULT_EXPORT_PATH));
      if (source === undefined) {
        ctx.ui.notify("Import cancelled.", "info");
        return;
      }

      const path = fileUtil.expandHome(source.trim() || DEFAULT_EXPORT_PATH);
      const bundle = parseImportBundle(JSON.parse(await readFile(path, "utf8")));

      const confirmed = await ctx.ui.confirm(
        "Import account switcher data?",
        `This will replace all existing accounts, providers, and state with data from ${path}.`,
      );
      if (!confirmed) {
        ctx.ui.notify("Import cancelled.", "info");
        return;
      }

      await fileUtil.writePrivateJson(ACCOUNTS_PATH, { accounts: bundle.accounts });
      await fileUtil.writePrivateJson(PROVIDERS_PATH, { providers: bundle.providers });
      await fileUtil.writePrivateJson(STATE_PATH, bundle.state);

      await this.runtime.load();
      await this.runtime.init(ctx);
      uiUtil.setAccountStatus(ctx.ui, this.runtime.getActiveAccount()?.label);

      ctx.ui.notify(
        `Imported ${bundle.accounts.length} accounts and ${bundle.providers.length} providers from ${path}.`,
        "info",
      );
    } catch (e) {
      ctx.ui.notify(`Failed to import: ${errorUtil.format(e)}`, "error");
    }
  }
}

function parseImportBundle(raw: unknown): ImportBundle {
  const parsed = exportBundleSchema.parse(raw);
  assertNoDuplicateIds(
    "account",
    parsed.accounts.map((account) => account.id),
  );
  assertNoDuplicateIds(
    "provider",
    parsed.providers.map((provider) => provider.id),
  );
  return parsed;
}

function assertNoDuplicateIds(kind: string, ids: string[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    else seen.add(id);
  }
  if (duplicates.size > 0) {
    throw new Error(`Duplicate ${kind} ids: ${Array.from(duplicates).sort().join(", ")}`);
  }
}
