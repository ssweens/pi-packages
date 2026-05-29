import z from "zod";

export const jsonRecordSchema = z.record(z.string(), z.unknown());
