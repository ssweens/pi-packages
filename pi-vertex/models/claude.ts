/**
 * Claude model definitions for Vertex AI
 * Source: https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-partner-models
 * Pricing: https://cloud.google.com/vertex-ai/generative-ai/pricing#partner-models
 * All prices per 1M tokens (global endpoint, <= 200K input tokens)
 * Cache write prices are for 5-minute TTL
 */

import type { VertexModelConfig } from "../types.js";

export const CLAUDE_MODELS: VertexModelConfig[] = [
  // Claude 4.7 series
  {
    id: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    apiId: "claude-opus-4-7",
    publisher: "anthropic",
    endpointType: "maas",
    contextWindow: 1000000,
    maxTokens: 32000,
    input: ["text", "image"],
    reasoning: true,
    tools: true,
    cost: {
      input: 5.0,
      output: 25.0,
      cacheRead: 0.5,
      cacheWrite: 6.25,
    },
    region: "global",
  },
  // Claude 4.6 series
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    apiId: "claude-opus-4-6",
    publisher: "anthropic",
    endpointType: "maas",
    contextWindow: 1000000,
    maxTokens: 32000,
    input: ["text", "image"],
    reasoning: true,
    tools: true,
    cost: {
      input: 5.00,
      output: 25.00,
      cacheRead: 0.50,
      cacheWrite: 6.25,
    },
    region: "global",
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    apiId: "claude-sonnet-4-6",
    publisher: "anthropic",
    endpointType: "maas",
    contextWindow: 1000000,
    maxTokens: 64000,
    input: ["text", "image"],
    reasoning: true,
    tools: true,
    cost: {
      input: 3.00,
      output: 15.00,
      cacheRead: 0.30,
      cacheWrite: 3.75,
    },
    region: "global",
  },

  // Claude 4.5 series
  {
    id: "claude-opus-4-5",
    name: "Claude Opus 4.5",
    apiId: "claude-opus-4-5@20251101",
    publisher: "anthropic",
    endpointType: "maas",
    contextWindow: 200000,
    maxTokens: 32000,
    input: ["text", "image"],
    reasoning: true,
    tools: true,
    cost: {
      input: 5.00,
      output: 25.00,
      cacheRead: 0.50,
      cacheWrite: 6.25,
    },
    region: "global",
  },
  {
    id: "claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    apiId: "claude-sonnet-4-5@20250929",
    publisher: "anthropic",
    endpointType: "maas",
    contextWindow: 200000,
    maxTokens: 64000,
    input: ["text", "image"],
    reasoning: true,
    tools: true,
    cost: {
      input: 3.00,
      output: 15.00,
      cacheRead: 0.30,
      cacheWrite: 3.75,
    },
    region: "global",
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    apiId: "claude-haiku-4-5@20251001",
    publisher: "anthropic",
    endpointType: "maas",
    contextWindow: 200000,
    maxTokens: 64000,
    input: ["text", "image"],
    reasoning: true,
    tools: true,
    cost: {
      input: 1.00,
      output: 5.00,
      cacheRead: 0.10,
      cacheWrite: 1.25,
    },
    region: "global",
  },

  // Claude 4.1 series
  {
    id: "claude-opus-4-1",
    name: "Claude Opus 4.1",
    apiId: "claude-opus-4-1@20250805",
    publisher: "anthropic",
    endpointType: "maas",
    contextWindow: 200000,
    maxTokens: 32000,
    input: ["text", "image"],
    reasoning: true,
    tools: true,
    cost: {
      input: 15.00,
      output: 75.00,
      cacheRead: 1.50,
      cacheWrite: 18.75,
    },
    region: "global",
  },

  // Claude 4.0 series
  {
    id: "claude-opus-4",
    name: "Claude Opus 4",
    apiId: "claude-opus-4@20250514",
    publisher: "anthropic",
    endpointType: "maas",
    contextWindow: 200000,
    maxTokens: 32000,
    input: ["text", "image"],
    reasoning: true,
    tools: true,
    cost: {
      input: 15.00,
      output: 75.00,
      cacheRead: 1.50,
      cacheWrite: 18.75,
    },
    region: "global",
  },
  {
    id: "claude-sonnet-4",
    name: "Claude Sonnet 4",
    apiId: "claude-sonnet-4@20250514",
    publisher: "anthropic",
    endpointType: "maas",
    contextWindow: 200000,
    maxTokens: 64000,
    input: ["text", "image"],
    reasoning: true,
    tools: true,
    cost: {
      input: 3.00,
      output: 15.00,
      cacheRead: 0.30,
      cacheWrite: 3.75,
    },
    region: "global",
  },

  // Claude 3.5 series
  {
    id: "claude-3-5-sonnet-v2",
    name: "Claude 3.5 Sonnet v2",
    apiId: "claude-3-5-sonnet-v2@20241022",
    publisher: "anthropic",
    endpointType: "maas",
    contextWindow: 200000,
    maxTokens: 8192,
    input: ["text", "image"],
    reasoning: false,
    tools: true,
    cost: {
      input: 3.00,
      output: 15.00,
      cacheRead: 0.30,
      cacheWrite: 3.75,
    },
    region: "global",
  },
];
