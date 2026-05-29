import AccountSwitcher from "./account-switcher";
import { ACCOUNTS_PATH, PROVIDERS_PATH, STATE_PATH } from "@/constants";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountConfig, AccountSwitcherContext, PiAuthEntry, ProviderConfig } from "@/types";
import type { AccountService, ModelService, PiAuthService, ProviderService } from "@/services";
import { useAccountService, useModelService, usePiAuthService, useProviderService } from "@/services";
import { accountUtil, modelUtil, providerUtil, uiUtil } from "@/utils";

function resolveAuthProvider(account: AccountConfig, providers: ProviderConfig[]): string {
  if (account.piAuth?.provider) return account.piAuth.provider;
  const provider = providerUtil.findProvider(account.provider, providers);
  return provider?.piAuthProvider ?? providerUtil.normalizeProvider(account.provider);
}

function resolveAccountProvider(account: AccountConfig, providers: ProviderConfig[]): string {
  return providerUtil.normalizeProviderWithCustom(resolveAuthProvider(account, providers), providers);
}

export default class AccountSwitcherRuntime implements AccountSwitcher {
  private accountService: AccountService;
  private modelService: ModelService;
  private piAuthService: PiAuthService;
  private providerService: ProviderService;

  constructor(private readonly pi: Pick<ExtensionAPI, "registerProvider" | "setModel">) {
    this.providerService = useProviderService(this.pi as ExtensionAPI, PROVIDERS_PATH);
    this.accountService = useAccountService(ACCOUNTS_PATH, STATE_PATH);
    this.modelService = useModelService(this.pi);
    this.piAuthService = usePiAuthService();
  }

  // ===============================================================================================
  // Core
  // ===============================================================================================

  async init(ctx: AccountSwitcherContext): Promise<void> {
    await this.load();

    const active = this.accountService.getActiveAccount();
    uiUtil.setAccountStatus(ctx.ui, active?.label);

    // Re-apply saved account credentials so env vars and OAuth auth storage are
    // populated on session start, not only after the first explicit switch.
    if (active) {
      const providers = this.providerService.getProviders();
      await this.applyProviderApiKey(active, providers);
      await accountUtil.applyAccountEnv(active, ctx.modelRegistry, resolveAuthProvider(active, providers));
    }

    // Restore the last active model. modelRegistry.find returns undefined if the
    // model is no longer available (e.g. provider was removed), in which case we
    // leave Pi's default model selection untouched.
    const modelState = this.accountService.getActiveModelState();
    if (modelState) {
      const providers = this.providerService.getProviders();
      const activeProvider = active ? resolveAccountProvider(active, providers) : undefined;
      const savedProvider = providerUtil.normalizeProviderWithCustom(modelState.provider, providers);

      // Only restore a saved model when it belongs to the active account's provider.
      // Otherwise Pi can start with credentials for one provider and a model from another.
      if (!activeProvider || savedProvider === activeProvider) {
        const model = ctx.modelRegistry.find(modelState.provider, modelState.id);
        if (model) await this.modelService.applyModel(model, ctx);
      }
    }
  }

  async load(): Promise<void> {
    await this.accountService.load();
    await this.providerService.load();
  }

  async onModelSelect(provider: string, ctx: AccountSwitcherContext): Promise<void> {
    const matchingAccount = this.findAccountsByProvider(provider)[0];
    const activeAccount = this.accountService.getActiveAccount();
    if (matchingAccount && matchingAccount.id !== activeAccount?.id) {
      await this.activateAccount(matchingAccount, ctx);
    }
  }

  // ===============================================================================================
  // Pi Auth
  // ===============================================================================================

  async getPiAuthEntry(provider: string): Promise<PiAuthEntry | undefined> {
    return this.piAuthService.getEntry(provider);
  }

  isOAuthEntry(entry: PiAuthEntry | undefined): boolean {
    return this.piAuthService.isOAuthEntry(entry);
  }

  // ===============================================================================================
  // Account
  // ===============================================================================================

  getAccounts(): AccountConfig[] {
    return this.accountService.getAccounts();
  }

  findAccountById(id: string): AccountConfig | undefined {
    return this.accountService.getAccounts().find((a) => a.id === id);
  }

  findAccountsByProvider(provider: string): AccountConfig[] {
    const providers = this.providerService.getProviders();
    const normalized = providerUtil.normalizeProviderWithCustom(provider, providers);
    return this.accountService.getAccounts().filter((a) => resolveAccountProvider(a, providers) === normalized);
  }

  getActiveAccount(): AccountConfig | undefined {
    return this.accountService.getActiveAccount();
  }

  async addAccount(account: AccountConfig): Promise<void> {
    return this.accountService.addAccount(account);
  }

  async editAccount(original: AccountConfig, updated: AccountConfig): Promise<void> {
    return this.accountService.editAccount(original, updated);
  }

  async removeAccount(account: AccountConfig): Promise<void> {
    return this.accountService.removeAccount(account);
  }

  async activateAccount(account: AccountConfig, ctx: AccountSwitcherContext): Promise<string> {
    const providers = this.providerService.getProviders();
    const providerApiKey = await this.applyProviderApiKey(account, providers);
    const result = await this.accountService.activateAccount(account, ctx, resolveAuthProvider(account, providers));

    // piAuth accounts authenticate via a separate provider (e.g. github-copilot),
    // so use that for model lookup rather than the account's own provider field.
    const accountProvider = resolveAccountProvider(account, providers);
    const currentProvider = ctx.model
      ? providerUtil.normalizeProviderWithCustom(ctx.model.provider, providers)
      : undefined;

    // Skip model selection if the active model already belongs to the same provider.
    if (accountProvider !== currentProvider) {
      const model = await modelUtil.pickModel(ctx, account, providers, accountProvider);
      if (model) await this.applyModel(model, ctx);
    }

    return providerApiKey ? `provider apiKey (${providerApiKey})` : result;
  }

  private async applyProviderApiKey(account: AccountConfig, providers: ProviderConfig[]): Promise<string | undefined> {
    if (!account.providerApiKey && !account.usesProviderApiKey) return undefined;

    const provider = providerUtil.findProvider(account.provider, providers);
    if (!provider) throw new Error(`Custom provider not found for account ${account.id}: ${account.provider}`);

    if (account.providerApiKey) {
      const apiKey = await accountUtil.resolveSecret(account.providerApiKey);
      if (!apiKey) throw new Error(`Resolved empty providerApiKey for account ${account.id}`);
      this.providerService.registerProvider({ ...provider, apiKey });
      return provider.id;
    }

    this.providerService.registerProvider(provider);
    return provider.id;
  }

  // ===============================================================================================
  // Model
  // ===============================================================================================

  async applyModel(model: Model<Api>, ctx: AccountSwitcherContext): Promise<void> {
    await this.modelService.applyModel(model, ctx);
    await this.accountService.saveActiveModel(model.id, model.provider);
  }

  // ===============================================================================================
  // Provider
  // ===============================================================================================

  getProviders(): ProviderConfig[] {
    return this.providerService.getProviders();
  }

  registerProvider(provider: ProviderConfig): void {
    this.providerService.registerProvider(provider);
  }

  async addProvider(provider: ProviderConfig): Promise<void> {
    return this.providerService.addProvider(provider);
  }

  async editProvider(original: ProviderConfig, updated: ProviderConfig): Promise<void> {
    return this.providerService.editProvider(original, updated);
  }

  async removeProvider(provider: ProviderConfig): Promise<void> {
    const providers = this.providerService.getProviders();
    const dependents = this.accountService.findAccountsByProvider(provider.id, providers);
    if (dependents.length > 0) {
      const names = dependents.map((a) => `"${a.label ?? a.id}"`).join(", ");
      throw new Error(`Cannot remove: ${names} ${dependents.length === 1 ? "uses" : "use"} this provider`);
    }
    return this.providerService.removeProvider(provider);
  }
}
