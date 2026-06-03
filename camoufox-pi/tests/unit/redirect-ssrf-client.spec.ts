import { describe, expect, it } from "vitest";

import { CamoufoxClient } from "../../src/client/camoufox-client.js";
import type { LookupFn } from "../../src/security/ssrf.js";
import {
	type FakeRoute,
	makeFakeLauncher,
	makeFakeRequest,
	makeFakeRoute,
} from "../helpers/fake-launcher.js";
import { safeLookup } from "../helpers/safe-lookup.js";

// TestableClient intercepts newPage() at the context level so latestPage is
// set as soon as the page is created — before goto begins. This lets tests
// fire synthesized route-handler events while goto/content() is still pending.
class TestableClient extends CamoufoxClient {
	public latestPage: unknown = null;

	protected getContext() {
		const ctx = super.getContext();
		const self = this;
		// Wrap newPage once per call so we capture the page immediately.
		const origNewPage = ctx.newPage.bind(ctx);
		const wrappedCtx = new Proxy(ctx, {
			get(target, prop) {
				if (prop === "newPage") {
					return async () => {
						const page = await origNewPage();
						self.latestPage = page;
						return page;
					};
				}
				// biome-ignore lint/suspicious/noExplicitAny: proxy passthrough
				return (target as any)[prop];
			},
		});
		return wrappedCtx;
	}
}

function firePage(page: unknown, req: ReturnType<typeof makeFakeRequest>, route: FakeRoute) {
	return (
		page as unknown as {
			__fireRequest: (r: unknown, rt: unknown) => Promise<void>;
		}
	).__fireRequest(req, route);
}

describe("CamoufoxClient — redirect-SSRF end-to-end", () => {
	it("pre-nav unsafe URL throws ssrf_blocked { hop: initial } (initial-URL migration)", async () => {
		const launcher = makeFakeLauncher();
		const privateLookup: LookupFn = (async () => [
			{ address: "10.0.0.1", family: 4 },
		]) as unknown as LookupFn;
		const client = new CamoufoxClient({ launcher, ssrfLookup: privateLookup });
		const p = client.fetchUrl("https://localhost-alias.test/", {
			signal: new AbortController().signal,
		});
		await expect(p).rejects.toMatchObject({
			err: { type: "ssrf_blocked", hop: "initial" },
		});
		await client.close();
	});

	it("mid-flight redirect to private IP throws ssrf_blocked { hop: redirect }", async () => {
		// Fake goto() runs with a delay so the test can synthesize a redirect-hop
		// into the registered route handler before goto resolves. After goto
		// resolves, navigate()'s post-goto getBlockedHop() check converts the
		// recorded block into ssrf_blocked.
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				gotoDelayMs: 50,
				status: 200,
				html: "<html></html>",
				finalUrl: "https://x.test/",
			}),
		});
		const client = new TestableClient({ launcher, ssrfLookup: safeLookup });
		const fetchP = client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
		});
		// Let navigate attach the guard and begin goto, then fire the hop.
		await new Promise((r) => setTimeout(r, 10));
		const page = client.latestPage;
		if (!page) throw new Error("page never registered — harness broken");
		const mainFrame = (page as unknown as { mainFrame(): unknown }).mainFrame();
		const prev = makeFakeRequest({
			url: "https://x.test/",
			framesMap: { mainFrame },
			mainFrame: true,
			isNavigation: true,
		});
		await firePage(
			page,
			makeFakeRequest({
				url: "http://169.254.169.254/latest/meta-data/",
				framesMap: { mainFrame },
				mainFrame: true,
				isNavigation: true,
				redirectedFrom: prev,
			}),
			makeFakeRoute(),
		);
		await expect(fetchP).rejects.toMatchObject({
			err: { type: "ssrf_blocked", hop: "redirect" },
		});
		await client.close();
	});

	it("subframe request to private IP fired during content() throws ssrf_blocked { hop: subframe }", async () => {
		// goto resolves immediately; content() delays so the test can fire an
		// unsafe subframe request DURING the post-nav pipeline. The final
		// post-pipeline re-check in fetchUrl catches it.
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html></html>",
				finalUrl: "https://x.test/",
				contentDelayMs: 50,
			}),
		});
		const client = new TestableClient({ launcher, ssrfLookup: safeLookup });
		const fetchP = client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
		});
		// Wait until navigate has resolved and the pipeline is in content(), then fire.
		await new Promise((r) => setTimeout(r, 20));
		const page = client.latestPage;
		if (!page) throw new Error("page never registered — harness broken");
		const mainFrame = (page as unknown as { mainFrame(): unknown }).mainFrame();
		await firePage(
			page,
			makeFakeRequest({
				url: "http://10.0.0.1/",
				framesMap: { mainFrame },
				mainFrame: false,
				isNavigation: true,
			}),
			makeFakeRoute(),
		);
		await expect(fetchP).rejects.toMatchObject({
			err: { type: "ssrf_blocked", hop: "subframe" },
		});
		await client.close();
	});

	it("public-only navigation yields normal success (no false positives)", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html>ok</html>",
				finalUrl: "https://example.test/",
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const res = await client.fetchUrl("https://example.test/", {
			signal: new AbortController().signal,
		});
		expect(res.status).toBe(200);
		expect(res.html).toContain("ok");
		await client.close();
	});
});
