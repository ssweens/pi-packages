import { readFile } from "node:fs/promises";
import { configSchema } from "@/schemas";
import type { AccountConfig, AccountSwitcherConfig } from "@/types";
import { errorUtil, fileUtil } from "@/utils";

export interface AccountStore {
  load(): Promise<AccountConfig[]>;
  addAccount(account: AccountConfig): Promise<AccountConfig[]>;
  replaceAccount(originalId: string, account: AccountConfig): Promise<AccountConfig[]>;
  removeAccount(id: string): Promise<AccountConfig[]>;
}

export function useAccountStore(path: string) {
  return new AccountStoreImpl(path);
}

// ===============================================================================================
// Account Store
// ===============================================================================================

class AccountStoreImpl implements AccountStore {
  constructor(private readonly path: string) {}

  async load(): Promise<AccountConfig[]> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = configSchema.parse(JSON.parse(raw));

      const { accounts } = parsed;
      accountValidator.assertNoDuplicateAccounts(accounts);
      accountValidator.assertAccountsHaveCredentials(accounts);

      return accounts;
    } catch (error) {
      if (fileUtil.isMissingFileError(error)) {
        return [];
      }
      throw new Error(`Failed to load accounts at ${this.path}: ${errorUtil.format(error)}`);
    }
  }

  async addAccount(account: AccountConfig): Promise<AccountConfig[]> {
    const accounts = await this.load();
    accountValidator.assertAccountIdAvailable(accounts, account.id);
    const next = [...accounts, account];
    await this.save(next);
    return next;
  }

  async replaceAccount(originalId: string, account: AccountConfig): Promise<AccountConfig[]> {
    const accounts = await this.load();
    const index = accounts.findIndex((a) => a.id === originalId);
    if (index === -1) throw new Error(`Account not found: ${originalId}`);
    accountValidator.assertAccountIdAvailable(accounts, account.id, originalId);
    const next = accounts.filter((a) => a.id !== originalId);
    next.splice(index, 0, account);
    await this.save(next);
    return next;
  }

  async removeAccount(id: string): Promise<AccountConfig[]> {
    const accounts = await this.load();
    const next = accounts.filter((a) => a.id !== id);
    if (next.length === accounts.length) throw new Error(`Account not found: ${id}`);
    await this.save(next);
    return next;
  }

  private async save(accounts: AccountConfig[]): Promise<void> {
    const config: AccountSwitcherConfig = { accounts };
    await fileUtil.writePrivateJson(this.path, config);
  }
}

// ===============================================================================================
// Account Validator
// ===============================================================================================

const accountValidator = {
  assertNoDuplicateAccounts: (accounts: AccountConfig[]): void => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const { id } of accounts) {
      if (seen.has(id)) duplicates.add(id);
      else seen.add(id);
    }
    if (duplicates.size > 0) {
      throw new Error(`Duplicate account ids: ${Array.from(duplicates).sort().join(", ")}`);
    }
  },

  assertAccountIdAvailable: (accounts: AccountConfig[], id: string, originalId?: string): void => {
    if (id === originalId) return;
    if (accounts.some((account) => account.id === id)) {
      throw new Error(`Account already exists: ${id}`);
    }
  },

  assertAccountsHaveCredentials: (accounts: AccountConfig[]): void => {
    const missing = accounts
      .filter(
        (a) => (!a.env || Object.keys(a.env).length === 0) && !a.providerApiKey && !a.usesProviderApiKey && !a.piAuth,
      )
      .map((a) => a.id);
    if (missing.length > 0) {
      throw new Error(`Accounts missing credentials: ${missing.sort().join(", ")}`);
    }
  },
};
