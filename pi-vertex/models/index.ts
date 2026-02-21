/**
 * Export all Vertex AI model definitions
 */

import { GEMINI_MODELS } from "./gemini.js";
import { CLAUDE_MODELS } from "./claude.js";
import { MAAS_MODELS } from "./maas.js";
import type { VertexModelConfig } from "../types.js";

export const ALL_MODELS: VertexModelConfig[] = [
  ...GEMINI_MODELS,
  ...CLAUDE_MODELS,
  ...MAAS_MODELS,
];

export function getModelById(id: string): VertexModelConfig | undefined {
  return ALL_MODELS.find((m) => m.id === id);
}

export function getModelsByEndpointType(type: "gemini" | "maas"): VertexModelConfig[] {
  return ALL_MODELS.filter((m) => m.endpointType === type);
}

export { GEMINI_MODELS, CLAUDE_MODELS, MAAS_MODELS };
