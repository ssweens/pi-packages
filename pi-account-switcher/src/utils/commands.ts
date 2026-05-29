import { COMMAND_PREFIX_ENV } from "@/constants";

export const commandUtil = {
  name: (name: string): string => {
    const prefix = process.env[COMMAND_PREFIX_ENV]?.trim();
    if (!prefix) return name;

    return `${prefix.endsWith(":") ? prefix : `${prefix}:`}${name}`;
  },
};
