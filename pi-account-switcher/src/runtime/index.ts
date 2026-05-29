import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type AccountSwitcher from "./account-switcher";
import AccountSwitcherRuntime from "./account-switcher-runtime";

function useAccountSwitcher(pi: Pick<ExtensionAPI, "registerProvider" | "setModel">): AccountSwitcher {
  return new AccountSwitcherRuntime(pi);
}

export { useAccountSwitcher, type AccountSwitcher };
