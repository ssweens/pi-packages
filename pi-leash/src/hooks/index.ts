import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ResolvedConfig } from "../config";
import { setupPermissionGateHook } from "./permission-gate";
import { setupPoliciesHook } from "./policies";

export function setupLeashHooks(pi: ExtensionAPI, config: ResolvedConfig) {
  setupPoliciesHook(pi, config);
  setupPermissionGateHook(pi, config);
}
