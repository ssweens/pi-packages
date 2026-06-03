import { describe, expect, it } from "vitest";

import { CamoufoxErrorBox } from "../../src/errors.js";

describe("sanitizeForMessage (via CamoufoxErrorBox.message)", () => {
	it("redacts Unix home path from stderr", () => {
		const box = new CamoufoxErrorBox({
			type: "browser_launch_failed",
			stderr: "cannot open /Users/monsieurbarti/.cache/camoufox/firefox",
		});
		expect(box.message).not.toContain("/Users/monsieurbarti");
		expect(box.message).toContain("<redacted>");
	});

	it("redacts /var and /tmp paths from stderr", () => {
		const box = new CamoufoxErrorBox({
			type: "browser_launch_failed",
			stderr: "ENOENT /var/folders/abc/T/x /tmp/x-123/socket",
		});
		expect(box.message).not.toContain("/var/folders");
		expect(box.message).not.toContain("/tmp/");
	});

	it("redacts /home and /root paths", () => {
		const box = new CamoufoxErrorBox({
			type: "browser_launch_failed",
			stderr: "stat /home/ci/.cache: failure (/root/.config also checked)",
		});
		expect(box.message).not.toContain("/home/ci");
		expect(box.message).not.toContain("/root/.config");
	});

	it("redacts Windows paths", () => {
		const box = new CamoufoxErrorBox({
			type: "browser_launch_failed",
			stderr: "stat C:\\Users\\bob\\AppData failed; also \\\\share\\foo\\bar",
		});
		expect(box.message).not.toContain("C:\\Users\\bob");
		expect(box.message).not.toContain("\\\\share\\foo");
	});

	it("redacts env-var references", () => {
		const box = new CamoufoxErrorBox({
			type: "browser_launch_failed",
			stderr: "expanded $HOME/.cache to ${FOO_BAR} or %USERPROFILE%\\x %APPDATA%",
		});
		expect(box.message).not.toContain("$HOME");
		expect(box.message).not.toContain("${FOO_BAR}");
		expect(box.message).not.toContain("%USERPROFILE%");
		expect(box.message).not.toContain("%APPDATA%");
	});

	it("also scrubs reason and cause fields (not just stderr)", () => {
		const box1 = new CamoufoxErrorBox({
			type: "config_invalid",
			field: "x",
			reason: "bad value at /Users/x/path",
		});
		expect(box1.message).not.toContain("/Users/x/path");

		const box2 = new CamoufoxErrorBox({
			type: "network",
			cause: "failed from $HOME",
			url: "https://example.com",
		});
		expect(box2.message).not.toContain("$HOME");
	});

	it("preserves non-sensitive content", () => {
		const box = new CamoufoxErrorBox({
			type: "http",
			status: 502,
			url: "https://example.com/p",
		});
		expect(box.message).toContain("http");
		expect(box.message).toContain("502");
		expect(box.message).toContain("example.com");
	});

	it("caps stderr length to 500 chars plus marker", () => {
		const long = "x".repeat(1200);
		const box = new CamoufoxErrorBox({ type: "browser_launch_failed", stderr: long });
		expect(box.message).toContain("…[1200 bytes]");
		expect(box.message.length).toBeLessThan(900);
	});

	it("redacts Windows paths with spaces in directory names", () => {
		const box = new CamoufoxErrorBox({
			type: "browser_launch_failed",
			stderr: "stat C:\\Users\\John Doe\\AppData\\Local\\x failed",
		});
		expect(box.message).not.toContain("John Doe");
		expect(box.message).not.toContain("AppData");
	});

	it("redacts lowercase and mixed-case env-var references", () => {
		const box = new CamoufoxErrorBox({
			type: "browser_launch_failed",
			stderr: "from $home or ${xdg_config_home} or %AppData% or %path%",
		});
		expect(box.message).not.toContain("$home");
		expect(box.message).not.toContain("${xdg_config_home}");
		expect(box.message).not.toContain("%AppData%");
		expect(box.message).not.toContain("%path%");
	});
});

describe("search_all_engines_blocked error variant", () => {
	it("serializes with lastSignal", () => {
		const box = new CamoufoxErrorBox({
			type: "search_all_engines_blocked",
			lastSignal: "sorry_interstitial",
		});
		expect(box.message).toContain("search_all_engines_blocked");
		expect(box.message).toContain("sorry_interstitial");
	});
});
