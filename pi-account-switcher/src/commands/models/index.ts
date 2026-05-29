import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import { useListModelsCommand } from "./list";
import { useAddModelCommand } from "./add";
import { useRemoveModelCommand } from "./remove";

const useModelCommands = (pi: ExtensionAPI, runtime: AccountSwitcher) => {
  useListModelsCommand(pi, runtime);
  useAddModelCommand(pi, runtime);
  useRemoveModelCommand(pi, runtime);
};

export default useModelCommands;
