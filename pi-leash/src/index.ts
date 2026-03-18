import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig } from "./config";
import { setupLeashHooks } from "./hooks";

/**
 * Pi Leash Extension
 *
 * Security hooks to prevent potentially dangerous operations:
 * - policies: File access policies with per-rule protection levels
 * - permission-gate: Prompts for confirmation on dangerous commands
 * - sudo-mode: Secure password handling for sudo commands
 *
 * Configuration:
 * - Global: ~/.pi/agent/settings/pi-leash.json
 *
 * Example config:
 * {
 *   "enabled": true,
 *   "features": {
 *     "policies": true,
 *     "permissionGate": true
 *   },
 *   "permissionGate": {
 *     "sudoMode": {
 *       "enabled": true,
 *       "timeout": 30000,
 *       "preserveEnv": false
 *     }
 *   }
 * }
 */
export default async function (pi: ExtensionAPI) {
  const config = loadConfig();

  if (!config.enabled) return;

  setupLeashHooks(pi, config);
}
