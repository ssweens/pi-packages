import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { ProviderModelConfig } from "@/types";
import { uiUtil } from "@/utils";

export class ModelConfigBuilder {
  private readonly prompt: ReturnType<typeof uiUtil.prompt>;
  private config: Partial<ProviderModelConfig> = {};

  constructor(readonly ui: ExtensionUIContext) {
    this.prompt = uiUtil.prompt(ui);
  }

  async withId(): Promise<this> {
    const raw = await this.prompt("Model id", "my-model").asText();
    if (!raw) throw new Error("Model id is required");
    this.config.id = raw.trim();
    return this;
  }

  async withName(): Promise<this> {
    this.config.name = await this.prompt("Display name (optional)", this.config.id).asText();
    return this;
  }

  build(): ProviderModelConfig {
    const { id } = this.config;
    if (!id) throw new Error("Model id is required");
    return { ...this.config, id };
  }

  async collect(): Promise<ProviderModelConfig> {
    await this.withId();
    await this.withName();
    return this.build();
  }
}
