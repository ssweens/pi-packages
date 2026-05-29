import { describe, expect, it } from "vitest";
import { commonUtil, providerUtil } from "@/utils";

const customProviders = [{ id: "acme", aliases: ["acme-ai"], envKeys: ["ACME_API_KEY"] }];

describe("commonUtil", () => {
  it("slugifies labels for account ids", () => {
    expect(commonUtil.slugify("Claude — Work Account")).toBe("claude-work-account");
  });

  it("normalizes provider ids with whitespace", () => {
    expect(providerUtil.normalizeProvider("Acme AI")).toBe("acme-ai");
  });

  it("deduplicates and trims string arrays", () => {
    expect(commonUtil.unique([" A ", "A", "", "B"])).toEqual(["A", "B"]);
  });
});

describe("providerUtil", () => {
  it("normalizes built-in aliases", () => {
    expect(providerUtil.normalizeProvider("Claude")).toBe("anthropic");
    expect(providerUtil.normalizeProvider("gemini")).toBe("google");
  });

  it("normalizes custom provider aliases", () => {
    expect(providerUtil.normalizeProviderWithCustom("acme-ai", customProviders)).toBe("acme");
  });
});
