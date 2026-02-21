#!/usr/bin/env tsx

/**
 * generate-image-models.ts
 *
 * Mirrors Pi's generate-models.ts pattern for image generation models.
 * Fetches from the same sources (OpenRouter, models.dev) but filters
 * for image OUTPUT capability instead of tool-use.
 *
 * Run: npx tsx scripts/generate-image-models.ts
 */

import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, "..");

// ── Types ──────────────────────────────────────────────────────────

interface ImageModel {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  /** API type determines how to call the model for image generation */
  api: "openai-images" | "openai-chat-image" | "google-generative-ai-image";
  /** Cost per image in USD (0 if unknown/free) */
  cost: number;
}

// ── OpenRouter: Dynamic Discovery ──────────────────────────────────

async function fetchOpenRouterImageModels(): Promise<ImageModel[]> {
  try {
    console.log("Fetching image models from OpenRouter...");
    const models: ImageModel[] = [];

    // Use frontend API — includes image-only models (FLUX, Riverflow, Seedream)
    // that the public /v1/models endpoint omits
    const frontendResponse = await fetch("https://openrouter.ai/api/frontend/models");
    if (frontendResponse.ok) {
      const data = (await frontendResponse.json()) as {
        data: Array<{
          slug: string;
          name: string;
          output_modalities?: string[];
        }>;
      };

      for (const model of data.data) {
        const outputMods = model.output_modalities ?? [];
        if (!outputMods.includes("image")) continue;
        if (model.slug === "openrouter/auto") continue;

        models.push({
          id: model.slug,
          name: model.name,
          provider: "openrouter",
          baseUrl: "https://openrouter.ai/api/v1",
          api: "openai-chat-image",
          cost: 0,
        });
      }

      console.log(`Fetched ${models.length} image-capable models from OpenRouter frontend API`);
      return models;
    }

    // Fallback to public /v1/models
    console.log("Frontend API unavailable, falling back to /v1/models...");
    const response = await fetch("https://openrouter.ai/api/v1/models");
    const data = (await response.json()) as {
      data: Array<{
        id: string;
        name: string;
        architecture?: {
          output_modalities?: string[];
        };
      }>;
    };

    for (const model of data.data) {
      const outputMods = model.architecture?.output_modalities ?? [];
      if (!outputMods.includes("image")) continue;
      if (model.id === "openrouter/auto") continue;

      models.push({
        id: model.id,
        name: model.name,
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        api: "openai-chat-image",
        cost: 0,
      });
    }

    console.log(`Fetched ${models.length} image-capable models from OpenRouter /v1/models`);
    return models;
  } catch (error) {
    console.error("Failed to fetch OpenRouter image models:", error);
    return [];
  }
}

// ── Static: Known Image Models ─────────────────────────────────────
// Hardcoded models for providers where we know the image generation
// endpoints but can't discover them dynamically (same pattern as Pi's
// generate-models.ts adding missing models).

function getStaticImageModels(): ImageModel[] {
  return [
    // OpenAI — /v1/images/generations endpoint
    {
      id: "gpt-image-1",
      name: "GPT Image 1",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      api: "openai-images",
      cost: 0, // Variable based on quality/size
    },
    {
      id: "dall-e-3",
      name: "DALL-E 3",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      api: "openai-images",
      cost: 0.04, // $0.040 per image (standard 1024x1024)
    },
    {
      id: "dall-e-2",
      name: "DALL-E 2",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      api: "openai-images",
      cost: 0.02, // $0.020 per image (1024x1024)
    },

    // Google Gemini — generateContent with responseModalities: ["IMAGE"]
    {
      id: "gemini-2.0-flash-preview-image-generation",
      name: "Gemini 2.0 Flash Image Preview",
      provider: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      api: "google-generative-ai-image",
      cost: 0,
    },
    {
      id: "imagen-3.0-generate-002",
      name: "Imagen 3.0",
      provider: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      api: "google-generative-ai-image",
      cost: 0,
    },
  ];
}

// ── Generate ───────────────────────────────────────────────────────

async function generateImageModels() {
  const staticModels = getStaticImageModels();
  const openRouterModels = await fetchOpenRouterImageModels();

  const allModels = [...staticModels, ...openRouterModels];

  // Deduplicate by provider+id (static takes priority)
  const seen = new Map<string, ImageModel>();
  for (const model of allModels) {
    const key = `${model.provider}/${model.id}`;
    if (!seen.has(key)) {
      seen.set(key, model);
    }
  }

  const deduped = [...seen.values()];

  // Group by provider
  const byProvider: Record<string, ImageModel[]> = {};
  for (const model of deduped) {
    if (!byProvider[model.provider]) byProvider[model.provider] = [];
    byProvider[model.provider].push(model);
  }

  // Sort providers and models within
  const sortedProviders = Object.keys(byProvider).sort();
  for (const p of sortedProviders) {
    byProvider[p].sort((a, b) => a.id.localeCompare(b.id));
  }

  // Generate TypeScript
  let output = `// This file is auto-generated by scripts/generate-image-models.ts
// Do not edit manually - run 'npx tsx scripts/generate-image-models.ts' to update

export type ImageApi = "openai-images" | "openai-chat-image" | "google-generative-ai-image";

export interface ImageModel {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  api: ImageApi;
  cost: number;
}

export const IMAGE_MODELS: Record<string, Record<string, ImageModel>> = {
`;

  for (const provider of sortedProviders) {
    output += `  ${JSON.stringify(provider)}: {\n`;
    for (const model of byProvider[provider]) {
      output += `    ${JSON.stringify(model.id)}: {\n`;
      output += `      id: ${JSON.stringify(model.id)},\n`;
      output += `      name: ${JSON.stringify(model.name)},\n`;
      output += `      provider: ${JSON.stringify(model.provider)},\n`;
      output += `      baseUrl: ${JSON.stringify(model.baseUrl)},\n`;
      output += `      api: ${JSON.stringify(model.api)},\n`;
      output += `      cost: ${model.cost},\n`;
      output += `    },\n`;
    }
    output += `  },\n`;
  }

  output += `};\n`;

  const outPath = join(packageRoot, "lib", "image-models.generated.ts");
  writeFileSync(outPath, output);
  console.log(`\nGenerated ${outPath}`);
  console.log(`\nImage Model Statistics:`);
  console.log(`  Total: ${deduped.length}`);
  for (const p of sortedProviders) {
    console.log(`  ${p}: ${byProvider[p].length} models`);
  }
}

generateImageModels().catch(console.error);
