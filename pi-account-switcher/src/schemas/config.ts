import z from "zod";
import { accountSchema } from "./accounts";

export const configSchema = z.object({
  accounts: z.array(accountSchema).default([]),
  switchMode: z.literal("env").optional().default("env"),
});
