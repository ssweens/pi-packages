import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import useProviderCommands from "./providers";
import useAccountCommands from "./accounts";
import useModelCommands from "./models";
import useSystemCommands from "./system";

export type { Command, CommandMeta } from "./base";
export { BaseCommand } from "./base";

export function registerAllCommands(pi: ExtensionAPI, runtime: AccountSwitcher) {
  useAccountCommands(pi, runtime);
  useProviderCommands(pi, runtime);
  useModelCommands(pi, runtime);
  useSystemCommands(pi, runtime);
}
