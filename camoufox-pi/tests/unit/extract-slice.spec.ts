import type { Page } from "playwright-core";
import { describe, expect, it } from "vitest";

import { extractSlice } from "../../src/client/fetch-pipeline.js";
import { CamoufoxErrorBox } from "../../src/errors.js";

type StubOpts = { outerHTML?: string | null; fullContent?: string };

function makeStubPage(opts: StubOpts): Page {
	return {
		async content(): Promise<string> {
			return opts.fullContent ?? "<html></html>";
		},
		locator(_sel: string) {
			const hasMatch = opts.outerHTML !== undefined && opts.outerHTML !== null;
			return {
				first() {
					return {
						async count(): Promise<number> {
							return hasMatch ? 1 : 0;
						},
						async evaluate<T>(fn: (el: { outerHTML: string }) => T): Promise<T> {
							return fn({ outerHTML: opts.outerHTML as string });
						},
					};
				},
			};
		},
	} as unknown as Page;
}

describe("extractSlice", () => {
	it("returns full page.content() when selector is undefined", async () => {
		const page = makeStubPage({ fullContent: "<html>whole</html>" });
		const res = await extractSlice(page, undefined);
		expect(res.html).toBe("<html>whole</html>");
	});

	it("returns outerHTML of first match when selector matches", async () => {
		const page = makeStubPage({ outerHTML: "<article>body</article>" });
		const res = await extractSlice(page, "article");
		expect(res.html).toBe("<article>body</article>");
	});

	it("throws config_invalid when selector has no match", async () => {
		const page = makeStubPage({ outerHTML: null });
		await expect(extractSlice(page, ".none")).rejects.toBeInstanceOf(CamoufoxErrorBox);
		await expect(extractSlice(page, ".none")).rejects.toMatchObject({
			err: { type: "config_invalid", field: "selector", reason: "no element matched" },
		});
	});

	it("throws config_invalid with sanitized reason when CSS syntax is invalid", async () => {
		const page = {
			async content(): Promise<string> {
				return "<html></html>";
			},
			locator(_sel: string) {
				return {
					first() {
						return {
							async count(): Promise<number> {
								throw new Error(
									"Unknown engine 'bogus' while parsing selector at /Users/alice/node_modules/playwright-core/lib/selectors.js:42",
								);
							},
							async evaluate<T>(): Promise<T> {
								throw new Error("unreachable");
							},
						};
					},
				};
			},
		} as unknown as Page;
		const p = extractSlice(page, "::bogus");
		await expect(p).rejects.toBeInstanceOf(CamoufoxErrorBox);
		await expect(p).rejects.toMatchObject({
			err: { type: "config_invalid", field: "selector" },
		});
		// Path should be sanitized out of the reason.
		await expect(p).rejects.toMatchObject({
			err: { reason: expect.not.stringContaining("/Users/alice") },
		});
	});
});
