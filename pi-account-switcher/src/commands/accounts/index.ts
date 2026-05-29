import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AccountSwitcher } from "@/runtime";
import { useAddAccountCommand } from "./add";
import { useEditAccountCommand } from "./edit";
import { useListAccountsCommand } from "./list";
import { useOAuthImportCommand } from "./oauth";
import { useRemoveAccountCommand } from "./remove";
import { useSwitchAccountCommand } from "./switch";
import { useVerifyAccountsCommand } from "./verify";

const useAccountCommands = (pi: ExtensionAPI, runtime: AccountSwitcher) => {
  useAddAccountCommand(pi, runtime);
  useEditAccountCommand(pi, runtime);
  useListAccountsCommand(pi, runtime);
  useOAuthImportCommand(pi, runtime);
  useRemoveAccountCommand(pi, runtime);
  useSwitchAccountCommand(pi, runtime);
  useVerifyAccountsCommand(pi, runtime);
};

export default useAccountCommands;
