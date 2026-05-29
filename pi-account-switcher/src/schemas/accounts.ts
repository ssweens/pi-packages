import { z } from "zod";

export const secretSourceSchema = z.union([
  z.string().min(1),
  z.object({ type: z.literal("literal"), value: z.string().min(1) }),
  z.object({ type: z.literal("env"), name: z.string().min(1) }),
  z.object({ type: z.literal("file"), path: z.string().min(1) }),
  z.object({ type: z.literal("command"), command: z.string().min(1) }),
  z.object({ type: z.literal("op"), reference: z.string().min(1) }),
]);

export const piAuthEntrySchema = z.union([
  z.object({ type: z.literal("api_key"), key: z.string().min(1) }),
  z
    .object({
      type: z.literal("oauth"),
      refresh: z.string().min(1),
      access: z.string().min(1),
      expires: z.number(),
    })
    .passthrough(),
]);

export const accountSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1).optional(),
    env: z.record(z.string().min(1), secretSourceSchema).optional(),
    providerApiKey: secretSourceSchema.optional(),
    usesProviderApiKey: z.boolean().optional(),
    piAuth: z
      .object({
        provider: z.string().min(1),
        entry: piAuthEntrySchema,
      })
      .optional(),
  })
  .refine(
    (account) =>
      (account.env && Object.keys(account.env).length > 0) ||
      account.providerApiKey ||
      account.usesProviderApiKey ||
      account.piAuth,
    {
      message: "Account must define env credentials, providerApiKey, provider apiKey, or piAuth credentials",
    },
  );
