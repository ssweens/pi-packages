import { mkdtemp, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { useAccountStore } from "./accounts";

describe("AccountStore", () => {
  it("persists accounts with owner-only permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "account-switcher-"));
    const path = join(dir, "accounts.json");
    const store = useAccountStore(path);

    await store.addAccount({
      id: "work",
      label: "Work",
      provider: "anthropic",
      env: { ANTHROPIC_API_KEY: { type: "literal", value: "secret" } },
    });

    expect(await store.load()).toHaveLength(1);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("rejects duplicate account ids on add", async () => {
    const dir = await mkdtemp(join(tmpdir(), "account-switcher-"));
    const path = join(dir, "accounts.json");
    const store = useAccountStore(path);

    await store.addAccount({ id: "work", label: "Work", provider: "anthropic", env: { KEY: "one" } });
    await expect(
      store.addAccount({ id: "work", label: "Other", provider: "openai", env: { KEY: "two" } }),
    ).rejects.toThrow(/Account already exists: work/);
  });

  it("rejects duplicate account ids on replace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "account-switcher-"));
    const path = join(dir, "accounts.json");
    const store = useAccountStore(path);

    await store.addAccount({ id: "work", label: "Work", provider: "anthropic", env: { KEY: "one" } });
    await store.addAccount({ id: "personal", label: "Personal", provider: "anthropic", env: { KEY: "two" } });

    await expect(
      store.replaceAccount("work", { id: "personal", label: "Renamed", provider: "anthropic", env: { KEY: "three" } }),
    ).rejects.toThrow(/Account already exists: personal/);
  });
});
