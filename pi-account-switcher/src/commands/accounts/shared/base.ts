import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import type { AccountConfig, AccountSwitcherContext } from "@/types";
import { uiUtil } from "@/utils";
import { BaseCommand, type CommandMeta } from "../../base";
import { buildGroupedItems, formatAccountItem } from "./select";

const DUPLICATE_ID_OPTIONS = {
  replace: "Replace existing account",
  newId: "Enter a new id",
  cancel: "Cancel",
} as const;

export abstract class AccountCommand extends BaseCommand {
  constructor(pi: ExtensionAPI, runtime: AccountSwitcher, meta: CommandMeta) {
    super(pi, runtime, meta);
  }

  protected async loadAccounts(ctx: AccountSwitcherContext): Promise<AccountConfig[] | undefined> {
    await this.runtime.load();
    const accounts = this.runtime.getAccounts();
    if (accounts.length === 0) {
      ctx.ui.notify("No accounts configured.", "info");
      return undefined;
    }
    return accounts;
  }

  protected async loadAndSelectAccount(ctx: AccountSwitcherContext, label: string): Promise<AccountConfig | undefined> {
    const accounts = await this.loadAccounts(ctx);
    if (!accounts) return undefined;
    return this.pickGroupedAccount(ctx, accounts, label);
  }

  protected async saveAccount(ctx: AccountSwitcherContext, account: AccountConfig): Promise<AccountConfig | undefined> {
    let candidate = account;
    while (true) {
      const existing = this.runtime.findAccountById(candidate.id);
      if (!existing) {
        await this.runtime.addAccount(candidate);
        return candidate;
      }

      const action = await ctx.ui.select(`Account id already exists: ${candidate.id}`, [
        DUPLICATE_ID_OPTIONS.replace,
        DUPLICATE_ID_OPTIONS.newId,
        DUPLICATE_ID_OPTIONS.cancel,
      ]);

      if (DUPLICATE_ID_OPTIONS.replace === action) {
        await this.runtime.editAccount(existing, candidate);
        return candidate;
      }

      if (DUPLICATE_ID_OPTIONS.newId === action) {
        const prompt = uiUtil.prompt(ctx.ui);
        const nextId = await prompt("New account id", `${candidate.id}-2`).asText();
        if (!nextId) return undefined;
        candidate = { ...candidate, id: nextId };
        continue;
      }

      return undefined;
    }
  }

  protected async pickGroupedAccount(
    ctx: AccountSwitcherContext,
    accounts: AccountConfig[],
    label = "Pick account",
  ): Promise<AccountConfig | undefined> {
    const { labels, values } = this.buildGroupedAccountSelectItems(accounts, true);
    return this.pickGrouped(ctx, label, labels, values);
  }

  protected async pickGroupedAccounts(
    ctx: AccountSwitcherContext,
    accounts: AccountConfig[],
    label = "Pick accounts",
  ): Promise<AccountConfig[] | undefined> {
    const activeId = this.runtime.getActiveAccount()?.id;
    const { labels, values } = this.buildGroupedAccountSelectItems(accounts, false);
    const firstAccountIndex = values.findIndex((value) => value !== null);
    const initialChecked = values.map((value, index) =>
      activeId ? value?.id === activeId : firstAccountIndex !== -1 && index === firstAccountIndex,
    );
    return uiUtil.multiGroupedSelect(ctx.ui, label, labels, values, initialChecked);
  }

  private buildGroupedAccountSelectItems(
    accounts: AccountConfig[],
    includeActiveMarker: boolean,
  ): {
    labels: string[];
    values: Array<AccountConfig | null>;
  } {
    const items = buildGroupedItems(accounts, this.runtime.getProviders(), this.runtime.getActiveAccount()?.id);

    const labels: string[] = [];
    const values: Array<AccountConfig | null> = [];
    for (const item of items) {
      if (item.type === "header") {
        labels.push(item.provider);
        values.push(null);
        continue;
      }
      labels.push(includeActiveMarker ? formatAccountItem(item) : this.formatMultiAccountItem(item));
      values.push(item.account);
    }

    return { labels, values };
  }

  private formatMultiAccountItem(
    item: Extract<ReturnType<typeof buildGroupedItems>[number], { type: "account" }>,
  ): string {
    return item.active ? `${item.account.label} (active)` : item.account.label;
  }
}
