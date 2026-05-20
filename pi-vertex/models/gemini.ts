/**
 * Gemini model definitions for Vertex AI
 * Source: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models
 * Pricing: https://cloud.google.com/vertex-ai/generative-ai/pricing
 * All prices per 1M tokens (standard tier, <= 200K input tokens)
 */

import type { VertexModelConfig } from "../types.js";

export const GEMINI_MODELS: VertexModelConfig[] = [
  // --- Gemini 3.5 (GA) ---
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    apiId: "gemini-3.5-flash",
    publisher: "google",
    endpointType: "gemini",
    contextWindow: 1048576,
    maxTokens: 65536,
    input: ["text", "image"],
    reasoning: true,
    tools: true,
    cost: {
      input: 1.50,
      output: 9.00,
      cacheRead: 0.15,
      cacheWrite: 0,
    },
    region: "global",
  },

  // --- Gemini 3.1 (Preview) ---
  {
    id: "gemini-3.1-pro",
    name: "Gemini 3.1 Pro",
    apiId: "gemini-3.1-pro-preview",
    publisher: "google",
    endpointType: "gemini",
    contextWindow: 1048576,
    maxTokens: 65536,
    input: ["text", "image"],
    reasoning: true,
    tools: true,
    cost: {
      input: 2.00,
      output: 12.00,
      cacheRead: 0.20,
      cacheWrite: 0,
    },
    region: "global",
  },
  {
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite",
    apiId: "gemini-3.1-flash-lite-preview",
    publisher: "google",
    endpointType: "gemini",
    contextWindow: 1048576,
    maxTokens: 65535,
    input: ["text", "image"],
    reasoning: true,
    tools: true,
    cost: {
      input: 0.25,
      output: 1.50,
      cacheRead: 0.025,
      cacheWrite: 0,
    },
    region: "global",
  },

  // --- Gemini 3 (Preview) ---
  {
    id: "gemini-3-flash",
    name: "Gemini 3 Flash",
    apiId: "gemini-3-flash-preview",
    publisher: "google",
    endpointType: "gemini",
    contextWindow: 1048576,
    maxTokens: 65536,
    input: ["text", "image"],
    reasoning: true,
    tools: true,
    cost: {
      input: 0.50,
      output: 3.00,
      cacheRead: 0.05,
      cacheWrite: 0,
    },
    region: "global",
  },

  // --- Gemini 2.5 (GA) ---
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    apiId: "gemini-2.5-pro",
    publisher: "google",
    endpointType: "gemini",
    contextWindow: 1048576,
    maxTokens: 65536,
    input: ["text", "image"],
    reasoning: true,
    tools: true,
    cost: {
      input: 1.25,
      output: 10.00,
      cacheRead: 0.125,
      cacheWrite: 0,
    },
    region: "global",
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    apiId: "gemini-2.5-flash",
    publisher: "google",
    endpointType: "gemini",
    contextWindow: 1048576,
    maxTokens: 65536,
    input: ["text", "image"],
    reasoning: true,
    tools: true,
    cost: {
      input: 0.30,
      output: 2.50,
      cacheRead: 0.03,
      cacheWrite: 0,
    },
    region: "global",
  },
  {
    id: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite",
    apiId: "gemini-2.5-flash-lite",
    publisher: "google",
    endpointType: "gemini",
    contextWindow: 1048576,
    maxTokens: 65536,
    input: ["text", "image"],
    reasoning: true,
    tools: true,
    cost: {
      input: 0.10,
      output: 0.40,
      cacheRead: 0.01,
      cacheWrite: 0,
    },
    region: "global",
  },

  // --- Gemini 2.0 (GA) ---
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    apiId: "gemini-2.0-flash",
    publisher: "google",
    endpointType: "gemini",
    contextWindow: 1048576,
    maxTokens: 8192,
    input: ["text", "image"],
    reasoning: false,
    tools: true,
    cost: {
      input: 0.15,
      output: 0.60,
      cacheRead: 0,
      cacheWrite: 0,
    },
    region: "global",
  },
  {
    id: "gemini-2.0-flash-lite",
    name: "Gemini 2.0 Flash Lite",
    apiId: "gemini-2.0-flash-lite",
    publisher: "google",
    endpointType: "gemini",
    contextWindow: 1048576,
    maxTokens: 8192,
    input: ["text", "image"],
    reasoning: false,
    tools: true,
    cost: {
      input: 0.075,
      output: 0.30,
      cacheRead: 0,
      cacheWrite: 0,
    },
    region: "global",
  },
];
