import type { Page } from "playwright-core";
import { describe, expect, it } from "vitest";

import { attachSsrfGuard } from "../../src/security/redirect-guard.js";
import type { LookupFn } from "../../src/security/ssrf.js";
import { makeFakeLauncher, makeFakeRequest, makeFakeRoute } from "../helpers/fake-launcher.js";

const publicLookup: LookupFn = (async () => [
	{ address: "93.184.216.34", family: 4 },
]) as unknown as LookupFn;

const throwingLookup: LookupFn = (async () => {
	throw new Error("ENOTFOUND");
}) as unknown as LookupFn;

async function makeFakePage(): Promise<{ page: Page }> {
	const launcher = makeFakeLauncher();
	const launched = await launcher.launch();
	const page = await launched.context.newPage();
	return { page };
}

type FireFn = (req: unknown, route: unknown) => Promise<void>;
function getFire(page: Page): FireFn {
	return (page as unknown as { __fireRequest: FireFn }).__fireRequest;
}
function getMainFrame(page: Page): unknown {
	return (page as unknown as { mainFrame(): unknown }).mainFrame();
}

describe("attachSsrfGuard", () => {
	it("continues main-frame initial document request to public host", async () => {
		const { page } = await makeFakePage();
		const guard = await attachSsrfGuard(page, { lookup: publicLookup });
		const mainFrame = getMainFrame(page);
		const route = makeFakeRoute();
		await getFire(page)(
			makeFakeRequest({
				url: "https://example.test/",
				framesMap: { mainFrame },
				mainFrame: true,
				isNavigation: true,
			}),
			route,
		);
		expect(route.calls.continued).toBe(1);
		expect(route.calls.aborted).toEqual([]);
		expect(guard.getBlockedHop()).toBeNull();
	});

	it("aborts initial main-frame request to 127.0.0.1", async () => {
		const { page } = await makeFakePage();
		const guard = await attachSsrfGuard(page, { lookup: publicLookup });
		const mainFrame = getMainFrame(page);
		const route = makeFakeRoute();
		await getFire(page)(
			makeFakeRequest({
				url: "http://127.0.0.1/",
				framesMap: { mainFrame },
				mainFrame: true,
				isNavigation: true,
			}),
			route,
		);
		expect(route.calls.continued).toBe(0);
		expect(route.calls.aborted).toEqual(["blockedbyclient"]);
		expect(guard.getBlockedHop()).toMatchObject({
			hop: "initial",
			url: "http://127.0.0.1/",
		});
		expect(guard.getBlockedHop()?.reason).toMatch(/private IPv4/);
	});

	it("classifies hop as redirect when redirectedFrom is non-null", async () => {
		const { page } = await makeFakePage();
		const guard = await attachSsrfGuard(page, { lookup: publicLookup });
		const mainFrame = getMainFrame(page);
		const prev = makeFakeRequest({
			url: "https://example.test/",
			framesMap: { mainFrame },
			mainFrame: true,
			isNavigation: true,
		});
		const route = makeFakeRoute();
		await getFire(page)(
			makeFakeRequest({
				url: "http://169.254.169.254/latest/meta-data/",
				framesMap: { mainFrame },
				mainFrame: true,
				isNavigation: true,
				redirectedFrom: prev,
			}),
			route,
		);
		expect(route.calls.aborted).toEqual(["blockedbyclient"]);
		expect(guard.getBlockedHop()).toMatchObject({
			hop: "redirect",
			url: "http://169.254.169.254/latest/meta-data/",
		});
	});

	it("classifies hop as subframe when frame is not main frame", async () => {
		const { page } = await makeFakePage();
		const guard = await attachSsrfGuard(page, { lookup: publicLookup });
		const mainFrame = getMainFrame(page);
		const route = makeFakeRoute();
		await getFire(page)(
			makeFakeRequest({
				url: "http://10.0.0.1/admin",
				framesMap: { mainFrame },
				mainFrame: false,
				isNavigation: true,
			}),
			route,
		);
		expect(route.calls.aborted).toEqual(["blockedbyclient"]);
		expect(guard.getBlockedHop()).toMatchObject({
			hop: "subframe",
			url: "http://10.0.0.1/admin",
		});
	});

	it("passes sub-resources (image) through untouched even to private IPs", async () => {
		const { page } = await makeFakePage();
		const guard = await attachSsrfGuard(page, { lookup: publicLookup });
		const mainFrame = getMainFrame(page);
		const route = makeFakeRoute();
		await getFire(page)(
			makeFakeRequest({
				url: "http://10.0.0.1/logo.png",
				resourceType: "image",
				framesMap: { mainFrame },
				mainFrame: true,
				isNavigation: false,
			}),
			route,
		);
		expect(route.calls.continued).toBe(1);
		expect(route.calls.aborted).toEqual([]);
		expect(guard.getBlockedHop()).toBeNull();
	});

	it("treats DNS lookup failures as unsafe (fail-safe)", async () => {
		const { page } = await makeFakePage();
		const guard = await attachSsrfGuard(page, { lookup: throwingLookup });
		const mainFrame = getMainFrame(page);
		const route = makeFakeRoute();
		await getFire(page)(
			makeFakeRequest({
				url: "https://unresolvable.invalid/",
				framesMap: { mainFrame },
				mainFrame: true,
				isNavigation: true,
			}),
			route,
		);
		expect(route.calls.aborted).toEqual(["blockedbyclient"]);
		expect(guard.getBlockedHop()).toMatchObject({ hop: "initial" });
		expect(guard.getBlockedHop()?.reason).toMatch(/cannot resolve/);
	});

	it("records only the first block when multiple unsafe requests fire", async () => {
		const { page } = await makeFakePage();
		const guard = await attachSsrfGuard(page, { lookup: publicLookup });
		const mainFrame = getMainFrame(page);
		const fire = getFire(page);
		const r1 = makeFakeRoute();
		await fire(
			makeFakeRequest({
				url: "http://10.0.0.1/",
				framesMap: { mainFrame },
				mainFrame: false,
				isNavigation: true,
			}),
			r1,
		);
		const r2 = makeFakeRoute();
		await fire(
			makeFakeRequest({
				url: "http://192.168.1.1/",
				framesMap: { mainFrame },
				mainFrame: false,
				isNavigation: true,
			}),
			r2,
		);
		expect(r1.calls.aborted).toEqual(["blockedbyclient"]);
		expect(r2.calls.aborted).toEqual(["blockedbyclient"]);
		expect(guard.getBlockedHop()?.url).toBe("http://10.0.0.1/");
	});

	it("blocks IPv6 loopback literals", async () => {
		const { page } = await makeFakePage();
		const guard = await attachSsrfGuard(page, { lookup: publicLookup });
		const mainFrame = getMainFrame(page);
		const route = makeFakeRoute();
		await getFire(page)(
			makeFakeRequest({
				url: "http://[::1]/",
				framesMap: { mainFrame },
				mainFrame: true,
				isNavigation: true,
			}),
			route,
		);
		expect(route.calls.aborted).toEqual(["blockedbyclient"]);
		expect(guard.getBlockedHop()?.reason).toMatch(/private IPv6/);
	});

	it("blocks when lookup returns any private address in a multi-address answer", async () => {
		const mixedLookup: LookupFn = (async () => [
			{ address: "93.184.216.34", family: 4 },
			{ address: "10.0.0.1", family: 4 },
		]) as unknown as LookupFn;
		const { page } = await makeFakePage();
		const _guard = await attachSsrfGuard(page, { lookup: mixedLookup });
		const mainFrame = getMainFrame(page);
		const route = makeFakeRoute();
		await getFire(page)(
			makeFakeRequest({
				url: "https://mixed.test/",
				framesMap: { mainFrame },
				mainFrame: true,
				isNavigation: true,
			}),
			route,
		);
		expect(route.calls.aborted).toEqual(["blockedbyclient"]);
	});

	it("detach unregisters handler but preserves recorded block state", async () => {
		const { page } = await makeFakePage();
		const guard = await attachSsrfGuard(page, { lookup: publicLookup });
		const mainFrame = getMainFrame(page);
		const fire = getFire(page);
		const r1 = makeFakeRoute();
		await fire(
			makeFakeRequest({
				url: "http://10.0.0.1/",
				framesMap: { mainFrame },
				mainFrame: true,
				isNavigation: true,
			}),
			r1,
		);
		expect(guard.getBlockedHop()).not.toBeNull();
		await guard.detach();
		// Post-detach __fireRequest walks registered handlers; none left → no-op.
		const r2 = makeFakeRoute();
		await fire(
			makeFakeRequest({
				url: "http://192.168.1.1/",
				framesMap: { mainFrame },
				mainFrame: true,
				isNavigation: true,
			}),
			r2,
		);
		expect(r2.calls.continued).toBe(0);
		expect(r2.calls.aborted).toEqual([]);
		expect(guard.getBlockedHop()?.url).toBe("http://10.0.0.1/");
	});

	it("blocks sub-resource to cloud-metadata endpoint (tiered policy)", async () => {
		const { page } = await makeFakePage();
		const guard = await attachSsrfGuard(page, { lookup: publicLookup });
		const mainFrame = getMainFrame(page);
		const route = makeFakeRoute();
		await getFire(page)(
			makeFakeRequest({
				url: "http://169.254.169.254/latest/meta-data/",
				resourceType: "image",
				framesMap: { mainFrame },
				mainFrame: true,
				isNavigation: false,
			}),
			route,
		);
		expect(route.calls.continued).toBe(0);
		expect(route.calls.aborted).toEqual(["blockedbyclient"]);
		expect(guard.getBlockedHop()).toMatchObject({
			hop: "subresource",
			url: "http://169.254.169.254/latest/meta-data/",
		});
		expect(guard.getBlockedHop()?.reason).toMatch(/cloud-metadata/);
	});

	it("assertNotBlocked throws CamoufoxError when a block is recorded", async () => {
		const { page } = await makeFakePage();
		const guard = await attachSsrfGuard(page, { lookup: publicLookup });
		const mainFrame = getMainFrame(page);
		await getFire(page)(
			makeFakeRequest({
				url: "http://127.0.0.1/",
				framesMap: { mainFrame },
				mainFrame: true,
				isNavigation: true,
			}),
			makeFakeRoute(),
		);
		expect(() => guard.assertNotBlocked()).toThrow(/ssrf_blocked/);
	});

	it("assertNotBlocked is a no-op when no block recorded", async () => {
		const { page } = await makeFakePage();
		const guard = await attachSsrfGuard(page, { lookup: publicLookup });
		expect(() => guard.assertNotBlocked()).not.toThrow();
	});

	it("popup pages get their own handler and blocks record on the parent guard (H3)", async () => {
		// Simulate window.open/target=_blank: the parent page emits a "popup"
		// event with the newly created page. The guard should attach to that
		// popup and route its unsafe requests through the same BlockedHop slot.
		const { page: parentPage } = await makeFakePage();
		const guard = await attachSsrfGuard(parentPage, { lookup: publicLookup });
		// Create a second page from the same launcher's context — it'll have
		// its own route/fireRequest surface.
		const launcher = makeFakeLauncher();
		const launched = await launcher.launch();
		const popupPage = await launched.context.newPage();
		// Fire the popup event: the guard's popupHandler will attachTo(popupPage).
		(parentPage as unknown as { __emit: (e: string, a: unknown) => void }).__emit(
			"popup",
			popupPage,
		);
		// Give the async attachTo a tick to register the handler on the popup.
		await new Promise((r) => setTimeout(r, 0));
		// Fire an unsafe request on the popup — should be blocked by the guard
		// that attached via the popup event.
		const mainFrame = (popupPage as unknown as { mainFrame(): unknown }).mainFrame();
		const route = makeFakeRoute();
		await (popupPage as unknown as { __fireRequest: FireFn }).__fireRequest(
			makeFakeRequest({
				url: "http://10.0.0.1/admin",
				framesMap: { mainFrame },
				mainFrame: true,
				isNavigation: true,
			}),
			route,
		);
		expect(route.calls.aborted).toEqual(["blockedbyclient"]);
		// Parent's guard sees the block — this is the H3 fix.
		expect(guard.getBlockedHop()).toMatchObject({
			url: "http://10.0.0.1/admin",
		});
	});
});
