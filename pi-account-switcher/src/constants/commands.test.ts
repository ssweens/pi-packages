import { afterEach, describe, expect, it, vi } from "vitest";
import { commandUtil } from "@/utils";
import { COMMANDS } from "./commands";

describe("COMMANDS", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not register legacy command aliases", () => {
    const entries = [
      ...Object.values(COMMANDS.accounts),
      ...Object.values(COMMANDS.providers),
      ...Object.values(COMMANDS.models),
      ...Object.values(COMMANDS.system),
    ];

    for (const command of entries) {
      expect(command).not.toHaveProperty("aliases");
    }
  });

  it("keeps command constants unprefixed", () => {
    vi.stubEnv("PI_ACCOUNT_SWITCHER_COMMAND_PREFIX", "dev");

    expect(COMMANDS.accounts.list.name).toBe("accounts:list");
    expect(COMMANDS.providers.list.name).toBe("providers:list");
  });

  it("uses unprefixed command names by default", () => {
    vi.stubEnv("PI_ACCOUNT_SWITCHER_COMMAND_PREFIX", "");

    expect(commandUtil.name(COMMANDS.accounts.list.name)).toBe("accounts:list");
    expect(commandUtil.name(COMMANDS.providers.list.name)).toBe("providers:list");
  });

  it("prefixes command names from the environment", () => {
    vi.stubEnv("PI_ACCOUNT_SWITCHER_COMMAND_PREFIX", "dev");

    expect(commandUtil.name(COMMANDS.accounts.list.name)).toBe("dev:accounts:list");
    expect(commandUtil.name(COMMANDS.providers.list.name)).toBe("dev:providers:list");
  });

  it("does not duplicate the separator when the prefix includes one", () => {
    vi.stubEnv("PI_ACCOUNT_SWITCHER_COMMAND_PREFIX", "dev:");

    expect(commandUtil.name(COMMANDS.accounts.list.name)).toBe("dev:accounts:list");
  });
});
