import z from "zod";

export const errorUtil = {
  format: (error: unknown): string => {
    if (error instanceof z.ZodError) {
      return error.issues.map((issue) => `${errorUtil.formatPath(issue.path)}: ${issue.message}`).join("; ");
    }
    return error instanceof Error ? error.message : String(error);
  },

  formatPath: (path: PropertyKey[]): string => {
    return path.length > 0 ? path.join(".") : "root";
  },
};
