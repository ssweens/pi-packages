import z from "zod";
import { jsonRecordSchema } from "@/schemas/common";

export const providerModelSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    api: z.string().min(1).optional(),
    baseUrl: z.string().min(1).optional(),
    reasoning: z.boolean().optional(),
    input: z.array(z.enum(["text", "image"])).optional(),
    contextWindow: z.number().int().positive().optional(),
    maxTokens: z.number().int().positive().optional(),
    cost: z
      .object({
        input: z.number(),
        output: z.number(),
        cacheRead: z.number(),
        cacheWrite: z.number(),
      })
      .optional(),
    compat: jsonRecordSchema.optional(),
    thinkingLevelMap: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

export const providerSchema = z
  .object({
    id: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    envKeys: z.array(z.string().min(1)).optional(),
    aliases: z.array(z.string().min(1)).optional(),
    piAuthProvider: z.string().min(1).optional(),
    baseUrl: z.string().min(1).optional(),
    api: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    authHeader: z.boolean().optional(),
    compat: jsonRecordSchema.optional(),
    models: z.array(providerModelSchema).optional(),
    modelOverrides: z.record(z.string(), providerModelSchema.partial()).optional(),
  })
  .passthrough();

export const providerCatalogRecordSchema = z.object({
  providers: z.record(z.string().min(1), providerSchema).default({}),
});

export const providerCatalogArraySchema = z.object({
  providers: z.array(providerSchema.extend({ id: z.string().min(1) })).default([]),
});
