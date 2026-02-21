/**
 * Authentication utilities for Vertex AI
 * Uses Google Application Default Credentials (ADC)
 *
 * Resolution order for each value: config file → env var → default
 */

import { GoogleAuth } from "google-auth-library";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { AuthConfig } from "./types.js";
import { loadConfig } from "./config.js";

const DEFAULT_ADC_PATH = join(homedir(), ".config", "gcloud", "application_default_credentials.json");

/**
 * Check if ADC credentials exist.
 * Checks config credentialsFile → GOOGLE_APPLICATION_CREDENTIALS → default ADC path.
 */
export function hasAdcCredentials(): boolean {
  const config = loadConfig();
  const adcPath =
    config.googleApplicationCredentials ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    DEFAULT_ADC_PATH;
  return existsSync(adcPath);
}

/**
 * Resolve project ID.
 * Checks config.googleCloudProject → GOOGLE_CLOUD_PROJECT → GCLOUD_PROJECT.
 */
export function resolveProjectId(): string | undefined {
  const config = loadConfig();
  return config.googleCloudProject || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
}

/**
 * Resolve location/region.
 * Checks config.googleCloudLocation → GOOGLE_CLOUD_LOCATION → CLOUD_ML_REGION → defaultLocation.
 */
export function resolveLocation(defaultLocation: string = "us-central1"): string {
  const config = loadConfig();
  return (
    config.googleCloudLocation ||
    process.env.GOOGLE_CLOUD_LOCATION ||
    process.env.CLOUD_ML_REGION ||
    defaultLocation
  );
}

/**
 * Get authentication configuration.
 */
export function getAuthConfig(preferredRegion?: string): AuthConfig {
  const projectId = resolveProjectId();
  if (!projectId) {
    throw new Error(
      "Vertex AI requires a project ID.\n" +
      `  Config file: set "project" in ${join(homedir(), ".pi", "agent", "config", "pi-vertex.json")}\n` +
      "  Env var: export GOOGLE_CLOUD_PROJECT=your-project-id\n" +
      "  Also ensure you've run: gcloud auth application-default login"
    );
  }

  if (!hasAdcCredentials()) {
    throw new Error(
      "Vertex AI requires Application Default Credentials.\n" +
      "  Run: gcloud auth application-default login\n" +
      `  Or set "credentialsFile" in ${join(homedir(), ".pi", "agent", "config", "pi-vertex.json")}`
    );
  }

  return {
    projectId,
    location: preferredRegion || resolveLocation(),
  };
}

/**
 * Get access token for HTTP requests.
 * Uses credentialsFile from config if set, otherwise relies on ADC.
 */
export async function getAccessToken(): Promise<string> {
  const config = loadConfig();
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    ...(config.googleApplicationCredentials ? { keyFile: config.googleApplicationCredentials } : {}),
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) {
    throw new Error("Failed to get access token from ADC");
  }
  return token.token;
}

/**
 * Build the base URL for Vertex AI endpoints
 */
export function buildBaseUrl(projectId: string, location: string): string {
  // Global endpoint uses aiplatform.googleapis.com without region prefix
  if (location === "global") {
    return `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global`;
  }
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}`;
}
