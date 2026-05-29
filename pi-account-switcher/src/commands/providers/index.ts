import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import { useAddProviderCommand } from "./add";
import { useEditProviderCommand } from "./edit";
import { useListProvidersCommand } from "./list";
import { useRemoveProviderCommand } from "./remove";

const useProviderCommands = (pi: ExtensionAPI, runtime: AccountSwitcher) => {
  useAddProviderCommand(pi, runtime);
  useEditProviderCommand(pi, runtime);
  useListProvidersCommand(pi, runtime);
  useRemoveProviderCommand(pi, runtime);
};

export default useProviderCommands;
