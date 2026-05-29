import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcherContext } from "@/types";

type ProviderModel = Model<Api>;

export interface ModelService {
  applyModel(model: ProviderModel, ctx: AccountSwitcherContext): Promise<void>;
}

export function useModelService(pi: Pick<ExtensionAPI, "setModel">): ModelService {
  return new ModelServiceImpl(pi);
}

class ModelServiceImpl implements ModelService {
  constructor(private readonly pi: Pick<ExtensionAPI, "setModel">) {}

  async applyModel(model: ProviderModel, ctx: AccountSwitcherContext): Promise<void> {
    const ok = await this.pi.setModel(model);
    if (!ok) {
      ctx.ui.notify(
        `Account switched, but Pi refused model ${model.provider}/${model.id}. Check credentials.`,
        "warning",
      );
    }
  }
}
