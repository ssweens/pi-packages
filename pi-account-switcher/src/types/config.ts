import { AccountConfig } from "./accounts";

export interface AccountSwitcherConfig {
  accounts: AccountConfig[];
  switchMode?: "env";
}
