import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ResolvedConfig } from "../config";
import { setupAutoMode } from "./auto-mode";
import { setupPathAccessHook } from "./path-access";
import { setupPermissionGateHook } from "./permission-gate";
import { setupPoliciesHook } from "./policies";

export function setupLeashHooks(pi: ExtensionAPI, config: ResolvedConfig) {
  const autoMode = setupAutoMode(pi, config);
  setupPathAccessHook(pi, config); // boundary check — runs first
  setupPoliciesHook(pi, config); // policy rules — runs second
  setupPermissionGateHook(pi, config, autoMode); // dangerous commands — runs third
}
