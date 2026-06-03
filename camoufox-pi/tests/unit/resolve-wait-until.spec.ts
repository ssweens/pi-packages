import { describe, expect, it } from "vitest";
import { resolveWaitUntil } from "../../src/client/fetch-pipeline.js";

describe("resolveWaitUntil", () => {
	it("maps static → domcontentloaded", () => {
		expect(resolveWaitUntil("static")).toBe("domcontentloaded");
	});
	it("maps render → load", () => {
		expect(resolveWaitUntil("render")).toBe("load");
	});
	it("maps render-and-wait → networkidle", () => {
		expect(resolveWaitUntil("render-and-wait")).toBe("networkidle");
	});
});
