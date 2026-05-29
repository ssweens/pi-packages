import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { useProviderService } from "@/services/providers";
import { useProviderStore } from "./providers";

function createPiStub() {
  return {
    registerProvider: vi.fn(),
  } as never;
}

describe("ProviderStore", () => {
  it("loads provider records and normalizes ids", async () => {
    const dir = await mkdtemp(join(tmpdir(), "account-switcher-"));
    const path = join(dir, "providers.json");
    await writeFile(path, JSON.stringify({ providers: { "Acme AI": { name: "Acme", apiKey: "ACME_API_KEY" } } }));

    await expect(useProviderStore(path).load()).resolves.toMatchObject([
      { id: "acme-ai", name: "Acme", label: "Acme", envKeys: ["ACME_API_KEY"] },
    ]);
  });

  it("rejects invalid provider catalog shapes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "account-switcher-"));
    const path = join(dir, "providers.json");
    await writeFile(path, JSON.stringify({ providers: "invalid" }));

    await expect(useProviderStore(path).load()).rejects.toThrow(/providers.json must contain either/);
  });
});

describe("ProviderService", () => {
  it("rejects duplicate provider ids on edit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "account-switcher-"));
    const path = join(dir, "providers.json");
    const service = useProviderService(createPiStub(), path);

    await service.load();
    await service.addProvider({ id: "acme", label: "Acme" });
    await service.addProvider({ id: "other", label: "Other" });

    await expect(
      service.editProvider({ id: "other", label: "Other" }, { id: "acme", label: "Renamed" }),
    ).rejects.toThrow(/Provider already exists: acme/);

    await expect(readFile(path, "utf8")).resolves.toContain('"id": "other"');
  });
});
