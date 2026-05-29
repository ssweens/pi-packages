import { describe, expect, it, vi } from "vitest";
import { accountUtil } from "./accounts";

describe("accountUtil", () => {
  it("resolves all env secrets before mutating process.env", async () => {
    const before = process.env.ACCOUNT_SWITCHER_TEST_KEY;
    process.env.ACCOUNT_SWITCHER_TEST_KEY = "old";

    try {
      await expect(
        accountUtil.applyAccountEnv({
          id: "broken",
          label: "Broken",
          provider: "anthropic",
          env: {
            ACCOUNT_SWITCHER_TEST_KEY: "new",
            ACCOUNT_SWITCHER_MISSING_KEY: { type: "env", name: "ACCOUNT_SWITCHER_DOES_NOT_EXIST" },
          },
        }),
      ).rejects.toThrow(/ACCOUNT_SWITCHER_DOES_NOT_EXIST/);

      expect(process.env.ACCOUNT_SWITCHER_TEST_KEY).toBe("old");
    } finally {
      if (before === undefined) delete process.env.ACCOUNT_SWITCHER_TEST_KEY;
      else process.env.ACCOUNT_SWITCHER_TEST_KEY = before;
    }
  });

  it("applies resolved env entries after successful resolution", () => {
    const authStorage = {
      setRuntimeApiKey: vi.fn(),
      removeRuntimeApiKey: vi.fn(),
    };

    const before = process.env.ACCOUNT_SWITCHER_TEST_KEY;
    try {
      const applied = accountUtil.applyResolvedAccountEnv(
        { id: "work", label: "Work", provider: "Claude" },
        [["ACCOUNT_SWITCHER_TEST_KEY", "new"]],
        { authStorage } as never,
      );

      expect(applied).toEqual(["ACCOUNT_SWITCHER_TEST_KEY"]);
      expect(process.env.ACCOUNT_SWITCHER_TEST_KEY).toBe("new");
      expect(authStorage.setRuntimeApiKey).toHaveBeenCalledWith("anthropic", "new");
    } finally {
      if (before === undefined) delete process.env.ACCOUNT_SWITCHER_TEST_KEY;
      else process.env.ACCOUNT_SWITCHER_TEST_KEY = before;
    }
  });
});
