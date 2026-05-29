import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import type { AccountConfig, AccountSwitcherContext, ProviderConfig } from "@/types";
import { commandUtil, providerUtil, uiUtil } from "@/utils";

function deduplicateLabels(labels: string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((label) => {
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    return n > 1 ? `${label} (${n})` : label;
  });
}

export interface CommandMeta {
  readonly name: string;
  readonly description: string;
}

export interface Command extends CommandMeta {
  register(): void;
  handler(ctx: AccountSwitcherContext, args?: string): Promise<void>;
}

export abstract class BaseCommand implements Command {
  readonly name: string;
  readonly description: string;

  constructor(
    protected readonly pi: ExtensionAPI,
    protected readonly runtime: AccountSwitcher,
    meta: CommandMeta,
  ) {
    this.name = commandUtil.name(meta.name);
    this.description = meta.description;
  }

  register(): void {
    this.pi.registerCommand(this.name, {
      description: this.description,
      handler: (args, ctx) => this.handler(ctx, args),
    });
  }

  protected async pickGrouped<T>(
    ctx: AccountSwitcherContext,
    label: string,
    labels: string[],
    values: Array<T | null>,
  ): Promise<T | undefined> {
    return uiUtil.filteredGroupedSelect(ctx.ui, label, labels, values);
  }

  protected async pick<T>(
    ctx: AccountSwitcherContext,
    label: string,
    items: T[],
    format: (item: T) => string,
  ): Promise<T | undefined> {
    const raw = items.map(format);
    const labels = deduplicateLabels(raw);
    const selected = await uiUtil.filteredSelect(ctx.ui, label, labels);
    if (!selected) return undefined;
    return items[labels.indexOf(selected)];
  }

  protected isActiveAccount(account: AccountConfig): boolean {
    return this.runtime.getActiveAccount()?.id === account.id;
  }

  protected isActiveProvider(provider: ProviderConfig): boolean {
    const active = this.runtime.getActiveAccount();
    return providerUtil.normalizeProvider(active?.provider ?? "") === provider.id;
  }

  protected isActiveModel(ctx: AccountSwitcherContext, modelId: string, provider?: string): boolean {
    if (ctx.model?.id !== modelId) return false;
    if (!provider) return true;
    const providers = this.runtime.getProviders();
    return (
      providerUtil.normalizeProviderWithCustom(ctx.model.provider, providers) ===
      providerUtil.normalizeProviderWithCustom(provider, providers)
    );
  }

  abstract handler(ctx: AccountSwitcherContext, args?: string): Promise<void>;
}
