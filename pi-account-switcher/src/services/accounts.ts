import { type AccountStore, useAccountStore, type StateStore, useStateStore } from "@/storage";
import type { AccountConfig, AccountSwitcherContext, ProviderConfig } from "@/types";
import { accountUtil, providerUtil, uiUtil } from "@/utils";

export interface AccountService {
  load(): Promise<void>;
  getAccounts(): AccountConfig[];
  findAccountsByProvider(provider: string, providers: ProviderConfig[]): AccountConfig[];
  getActiveAccount(): AccountConfig | undefined;
  addAccount(account: AccountConfig): Promise<void>;
  editAccount(original: AccountConfig, updated: AccountConfig): Promise<void>;
  removeAccount(account: AccountConfig): Promise<void>;
  activateAccount(account: AccountConfig, ctx: AccountSwitcherContext, authProvider?: string): Promise<string>;
  getActiveModelState(): { id: string; provider: string } | undefined;
  saveActiveModel(id: string, provider: string): Promise<void>;
}

export function useAccountService(accountsPath: string, statePath?: string): AccountService {
  return new AccountServiceImpl(useAccountStore(accountsPath), useStateStore(statePath));
}

// ===============================================================================================
// Account Service
// ===============================================================================================

class AccountServiceImpl implements AccountService {
  private accounts: AccountConfig[] = [];
  private activeAccountId: string | undefined;
  private activeModelId: string | undefined;
  private activeModelProvider: string | undefined;

  constructor(
    private readonly store: AccountStore,
    private readonly stateStore: StateStore,
  ) {}

  async load(): Promise<void> {
    this.accounts = await this.store.load();
    const state = await this.stateStore.load();
    this.activeAccountId = state.activeAccountId;
    this.activeModelId = state.activeModelId;
    this.activeModelProvider = state.activeModelProvider;
  }

  getAccounts(): AccountConfig[] {
    return this.accounts;
  }

  findAccountsByProvider(provider: string, providers: ProviderConfig[]): AccountConfig[] {
    const normalized = providerUtil.normalizeProviderWithCustom(provider, providers);
    return this.accounts.filter(
      (account) => providerUtil.normalizeProviderWithCustom(account.provider, providers) === normalized,
    );
  }

  getActiveAccount(): AccountConfig | undefined {
    return this.accounts.find((a) => a.id === this.activeAccountId);
  }

  getActiveModelState(): { id: string; provider: string } | undefined {
    if (!this.activeModelId || !this.activeModelProvider) return undefined;
    return { id: this.activeModelId, provider: this.activeModelProvider };
  }

  async saveActiveModel(id: string, provider: string): Promise<void> {
    this.activeModelId = id;
    this.activeModelProvider = provider;
    await this.flushState();
  }

  async addAccount(account: AccountConfig): Promise<void> {
    this.accounts = await this.store.addAccount(account);
  }

  async editAccount(original: AccountConfig, updated: AccountConfig): Promise<void> {
    this.accounts = await this.store.replaceAccount(original.id, updated);
    if (this.activeAccountId === original.id) {
      this.activeAccountId = updated.id;
      await this.flushState();
    }
  }

  async removeAccount(account: AccountConfig): Promise<void> {
    this.accounts = await this.store.removeAccount(account.id);
    if (this.activeAccountId === account.id) {
      this.activeAccountId = undefined;
      await this.flushState();
    }
  }

  async activateAccount(account: AccountConfig, ctx: AccountSwitcherContext, authProvider?: string): Promise<string> {
    const previous = this.getActiveAccount();
    let applied: string[] = [];
    if (account.piAuth) {
      if (previous) await accountUtil.clearAccountEnv(previous, ctx.modelRegistry);
      applied = await accountUtil.applyAccountEnv(account, ctx.modelRegistry, authProvider);
    } else {
      const resolved = await accountUtil.resolveAccountEnv(account);
      if (previous) await accountUtil.clearAccountEnv(previous, ctx.modelRegistry);
      applied = accountUtil.applyResolvedAccountEnv(account, resolved, ctx.modelRegistry, authProvider);
    }
    this.activeAccountId = account.id;
    await this.flushState();
    uiUtil.setAccountStatus(ctx.ui, account.label);
    if (account.piAuth) return "via OAuth";
    return applied.length > 0 ? applied.join(", ") : "";
  }

  private async flushState(): Promise<void> {
    await this.stateStore.save({
      activeAccountId: this.activeAccountId,
      activeModelId: this.activeModelId,
      activeModelProvider: this.activeModelProvider,
    });
  }
}
