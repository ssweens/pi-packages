import { completeSimple, type Api, type Model } from "@earendil-works/pi-ai";
import type { AuthCredential, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import type { AccountConfig, AccountSwitcherContext, ProviderConfig, SecretSource } from "@/types";
import { COMMANDS } from "@/constants";
import { accountUtil, commonUtil, errorUtil, providerUtil, uiUtil } from "@/utils";
import { AccountCommand } from "./shared";

export const useVerifyAccountsCommand = (pi: ExtensionAPI, runtime: AccountSwitcher) => {
  new VerifyAccountsCommand(pi, runtime).register();
};

type VerifyTestPlan = {
  secrets: boolean;
  ping: boolean;
};

type CheckResult = {
  ok: boolean;
  line: string;
};

type AccountVerifyReport = {
  account: AccountConfig;
  ok: boolean;
  lines: string[];
};

const TEST_OPTIONS = {
  secrets: "Verify secrets",
  ping: "Send ping",
} as const;

const MAX_PARALLEL_VERIFY = 3;

class VerifyAccountsCommand extends AccountCommand {
  constructor(pi: ExtensionAPI, runtime: AccountSwitcher) {
    super(pi, runtime, COMMANDS.accounts.verify);
  }

  async handler(ctx: AccountSwitcherContext, args?: string): Promise<void> {
    try {
      const accounts = await this.loadAccounts(ctx);
      if (!accounts) return;

      const parts = (args ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
      const verifyAll = parts.includes("all");
      const pingArg = parts.includes("ping") || parts.includes("probe") || parts.includes("connect");
      const targets = verifyAll
        ? accounts
        : await this.pickGroupedAccounts(ctx, accounts, pingArg ? "Verify and ping accounts" : "Verify accounts");

      if (!targets || targets.length === 0) return;

      const plan = pingArg ? { secrets: true, ping: true } : await this.pickTestPlan(ctx);
      if (!plan) return;

      const selectedTests = this.formatSelectedTests(plan);
      ctx.ui.notify(
        `Testing ${targets.length} account${targets.length === 1 ? "" : "s"} (${selectedTests})...`,
        "info",
      );

      const concurrency = plan.ping ? 1 : MAX_PARALLEL_VERIFY;
      const reports = await commonUtil.runWithConcurrency(targets, concurrency, (account) =>
        this.verifyAccount(ctx, account, plan),
      );
      const failed = reports.filter((report) => !report.ok).length;

      ctx.ui.setEditorText(this.formatReport(plan, reports));
      ctx.ui.notify(
        `Finished testing ${targets.length} account${targets.length === 1 ? "" : "s"}${
          failed ? ` — ${failed} failed` : " — all checks passed"
        }.`,
        failed ? "warning" : "info",
      );
    } catch (error) {
      ctx.ui.notify(`accounts:verify failed: ${errorUtil.format(error)}`, "error");
    }
  }

  private async pickTestPlan(ctx: AccountSwitcherContext): Promise<VerifyTestPlan | undefined> {
    const selected = await uiUtil.multiSelect(
      ctx.ui,
      "What should be tested?",
      [TEST_OPTIONS.secrets, TEST_OPTIONS.ping],
      [true, false],
    );

    if (!selected) return undefined;

    const plan = {
      secrets: selected.includes(TEST_OPTIONS.secrets),
      ping: selected.includes(TEST_OPTIONS.ping),
    };

    if (!plan.secrets && !plan.ping) {
      ctx.ui.notify("No tests selected.", "info");
      return undefined;
    }

    return plan;
  }

  private async verifyAccount(
    ctx: AccountSwitcherContext,
    account: AccountConfig,
    plan: VerifyTestPlan,
  ): Promise<AccountVerifyReport> {
    const lines: string[] = [];
    let ok = true;

    if (plan.secrets) {
      let anyChecked = false;

      if (account.piAuth) {
        lines.push("✓ secrets: using stored OAuth/piAuth credentials");
      }

      if (account.usesProviderApiKey && !account.providerApiKey) {
        lines.push("✓ secrets: using provider config apiKey");
      }

      const secretChecks: Array<[string, SecretSource]> = [];
      if (account.providerApiKey) secretChecks.push(["providerApiKey", account.providerApiKey]);
      if (!account.piAuth && account.env) {
        for (const [envName, source] of Object.entries(account.env)) secretChecks.push([envName, source]);
      }

      if (secretChecks.length > 0) {
        const results = await Promise.all(secretChecks.map(([key, source]) => this.verifySecret(key, source)));
        for (const result of results) {
          lines.push(result.line);
          ok &&= result.ok;
        }
      } else if (!account.piAuth && !account.usesProviderApiKey) {
        lines.push("ℹ secrets: no secrets configured");
      }
    }

    if (plan.ping) {
      const result = await this.pingAccount(ctx, account);
      lines.push(result.line);
      ok &&= result.ok;
    }

    return { account, ok, lines };
  }

  private async pingAccount(ctx: AccountSwitcherContext, account: AccountConfig): Promise<CheckResult> {
    const prefix = `[${account.label}]`;
    const authProvider = this.resolveAuthProvider(account);
    const model = this.resolveProbeModel(ctx, account, authProvider);
    if (!model) {
      return { ok: false, line: `✗ ping: skipped — no model found for provider ${authProvider}` };
    }

    const envBackup = new Map<string, string | undefined>();
    let authBackup: AuthCredential | undefined;
    let hadAuth = false;
    let providerToRestore: ProviderConfig | undefined;

    let requestAuth!: Awaited<ReturnType<typeof ctx.modelRegistry.getApiKeyAndHeaders>>;
    try {
      if (!account.piAuth && account.env) {
        const resolved = await accountUtil.resolveAccountEnv(account);
        for (const [envName, value] of resolved) {
          envBackup.set(envName, process.env[envName]);
          process.env[envName] = value;
        }
      }

      if (account.piAuth) {
        hadAuth = ctx.modelRegistry.authStorage.has(authProvider);
        authBackup = ctx.modelRegistry.authStorage.get(authProvider);
        ctx.modelRegistry.authStorage.set(authProvider, account.piAuth.entry);
        ctx.modelRegistry.authStorage.reload();
      }

      if (account.providerApiKey) {
        const provider = providerUtil.findProvider(account.provider, this.runtime.getProviders());
        if (provider) {
          providerToRestore = provider;
          const apiKey = await accountUtil.resolveSecret(account.providerApiKey);
          if (!apiKey) throw new Error("Resolved empty providerApiKey for ping");
          this.runtime.registerProvider({ ...provider, apiKey });
        }
      }

      requestAuth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!requestAuth.ok) throw new Error(requestAuth.error);
    } catch (err) {
      return { ok: false, line: `✗ ping: unable to prepare credentials — ${errorUtil.format(err)}` };
    } finally {
      for (const [envName, previous] of envBackup) {
        if (previous === undefined) delete process.env[envName];
        else process.env[envName] = previous;
      }
      if (account.piAuth) {
        if (hadAuth && authBackup) ctx.modelRegistry.authStorage.set(authProvider, authBackup);
        else ctx.modelRegistry.authStorage.remove(authProvider);
        ctx.modelRegistry.authStorage.reload();
      }
      if (providerToRestore) {
        this.runtime.registerProvider(providerToRestore);
      }
    }

    try {
      ctx.ui.notify(`${prefix} ping: sending request via ${model.provider}/${model.id}...`, "info");

      const response = await completeSimple(
        model,
        {
          systemPrompt: "You are a health-check endpoint. Follow the user instruction exactly.",
          messages: [
            {
              role: "user",
              content: "Health check: reply with exactly OK.",
              timestamp: Date.now(),
            },
          ],
        },
        {
          apiKey: requestAuth.apiKey,
          headers: requestAuth.headers,
          maxTokens: 16,
          timeoutMs: 30_000,
          maxRetries: 0,
          reasoning: "minimal",
        },
      );

      if (response.stopReason === "error") throw new Error(response.errorMessage ?? "model returned an error");
      const text = response.content.find((block) => block.type === "text")?.text?.trim();
      return { ok: true, line: `✓ ping: OK via ${model.provider}/${model.id}${text ? ` — ${text}` : ""}` };
    } catch (err) {
      return { ok: false, line: `✗ ping: failed — ${errorUtil.format(err)}` };
    }
  }

  private resolveAuthProvider(account: AccountConfig): string {
    if (account.piAuth?.provider) return account.piAuth.provider;
    const provider = providerUtil.findProvider(account.provider, this.runtime.getProviders());
    return provider?.piAuthProvider ?? providerUtil.normalizeProvider(account.provider);
  }

  private resolveProbeModel(
    ctx: AccountSwitcherContext,
    account: AccountConfig,
    authProvider: string,
  ): Model<Api> | undefined {
    const providers = this.runtime.getProviders();
    const normalized = providerUtil.normalizeProviderWithCustom(authProvider, providers);
    if (account.model) {
      const configured = ctx.modelRegistry.find(authProvider, account.model);
      if (configured) return configured;
    }
    if (ctx.model && providerUtil.normalizeProviderWithCustom(ctx.model.provider, providers) === normalized) {
      return ctx.model;
    }
    return ctx.modelRegistry
      .getAll()
      .find((model) => providerUtil.normalizeProviderWithCustom(model.provider, providers) === normalized);
  }

  private async verifySecret(key: string, source: SecretSource): Promise<CheckResult> {
    try {
      const value = await accountUtil.resolveSecret(source);
      if (!value) throw new Error("resolved to empty value");
      return { ok: true, line: `✓ secrets: ${key} OK` };
    } catch (err) {
      return { ok: false, line: `✗ secrets: ${key} failed — ${errorUtil.format(err)}` };
    }
  }

  private formatReport(plan: VerifyTestPlan, reports: AccountVerifyReport[]): string {
    const selectedTests = this.formatSelectedTests(plan);
    const passed = reports.filter((report) => report.ok).length;

    return [
      "Account verify results",
      "",
      `Tests: ${selectedTests}`,
      `Accounts: ${reports.length} (${passed} passed, ${reports.length - passed} failed)`,
      "",
      ...reports.flatMap((report) => [
        `${report.ok ? "✓" : "✗"} ${report.account.label}`,
        ...report.lines.map((line) => `  ${line}`),
        "",
      ]),
    ].join("\n");
  }

  private formatSelectedTests(plan: VerifyTestPlan): string {
    return [plan.secrets ? "secrets" : undefined, plan.ping ? "ping" : undefined].filter(Boolean).join(" + ");
  }
}
