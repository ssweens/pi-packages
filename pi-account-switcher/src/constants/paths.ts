import { homedir } from "node:os";
import { join } from "node:path";

export const APP_DIR = join(homedir(), ".pi", "account-switcher");
export const ACCOUNTS_PATH = join(APP_DIR, "accounts.json");
export const PROVIDERS_PATH = join(APP_DIR, "providers.json");
export const STATE_PATH = join(APP_DIR, "state.json");
export const PI_AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");
export const DEFAULT_EXPORT_PATH = "~/pi-account-switcher-export.json";
