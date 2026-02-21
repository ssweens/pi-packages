/**
 * Config loader for pi-vertex
 *
 * Reads ~/.pi/agent/settings/pi-vertex.json (if present).
 * All fields are optional — env vars remain a supported fallback.
 *
 * Config keys are camelCase versions of the corresponding env var names:
 *
 *   {
 *     "googleCloudProject":          "my-gcp-project",
 *     "googleCloudLocation":         "us-central1",
 *     "googleApplicationCredentials": "/path/to/service-account.json"
 *   }
 */

import { getAgentDir, CONFIG_DIR_NAME } from "@mariozechner/pi-coding-agent";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function getConfigPath(): string {
  return join(getAgentDir(), "settings", "pi-vertex.json");
}

export interface VertexConfig {
  /** GCP project ID. Equivalent to GOOGLE_CLOUD_PROJECT. */
  googleCloudProject?: string;
  /** Default region/location. Equivalent to GOOGLE_CLOUD_LOCATION. */
  googleCloudLocation?: string;
  /** Path to a service account JSON key. Equivalent to GOOGLE_APPLICATION_CREDENTIALS. */
  googleApplicationCredentials?: string;
}

let _cachedPath: string | null = null;
let _globalCached: VertexConfig | null = null;

function loadGlobalConfig(): VertexConfig {
  const configPath = getConfigPath();
  // Bust cache if agentDir changed (e.g. different process env)
  if (_cachedPath !== configPath) {
    _cachedPath = configPath;
    _globalCached = null;
  }
  if (_globalCached !== null) return _globalCached;

  if (!existsSync(configPath)) {
    _globalCached = {};
    return _globalCached;
  }

  try {
    _globalCached = JSON.parse(readFileSync(configPath, "utf-8")) as VertexConfig;
    return _globalCached;
  } catch (err) {
    console.warn(`[pi-vertex] Failed to parse ${configPath}: ${err}`);
    _globalCached = {};
    return _globalCached;
  }
}

/** Load config, merging global settings with project-level overrides.
 *  Project config wins on any key it defines. */
export function loadConfig(cwd: string = process.cwd()): VertexConfig {
  const global = loadGlobalConfig();
  const projectPath = join(cwd, CONFIG_DIR_NAME, "settings", "pi-vertex.json");

  if (!existsSync(projectPath)) return global;

  try {
    const project = JSON.parse(readFileSync(projectPath, "utf-8")) as VertexConfig;
    return { ...global, ...project };
  } catch (err) {
    console.warn(`[pi-vertex] Failed to parse ${projectPath}: ${err}`);
    return global;
  }
}
