// Minimal element stub used by duckduckgo-adapter.spec.ts. Mimics just the
// Element surface the adapter's $$eval callback reads: querySelector /
// textContent / href. We parse the fixture with regex — DDG HTML is
// deterministic enough and the alternative (jsdom) is a heavy dep for one
// contract test.

export interface ElementStub {
	querySelector(selector: string): ElementStub | null;
	textContent: string;
	getAttribute(name: string): string | null;
}

const RESULT_BLOCK_SPLIT_RE = /(?=<div[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>)/gi;
const A_RE = /<a[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
const SNIPPET_RE = /<a[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i;

function stripHtml(s: string): string {
	return s
		.replace(/<[^>]+>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#x27;/g, "'")
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&nbsp;/g, " ")
		.trim();
}

function decodeDdgRedirect(href: string): string {
	const m = href.match(/[?&]uddg=([^&]+)/);
	if (m?.[1]) {
		try {
			return decodeURIComponent(m[1]);
		} catch {
			// fall through to raw
		}
	}
	if (href.startsWith("//")) return `https:${href}`;
	return href;
}

export function parseDuckDuckGoFixture(html: string, selector: string): ElementStub[] {
	if (selector !== "div.result, div.web-result") return [];
	const blocks = html.split(RESULT_BLOCK_SPLIT_RE).filter((b) => A_RE.test(b));
	const elements: ElementStub[] = [];
	for (const block of blocks) {
		const a = block.match(A_RE);
		if (!a) continue;
		const href = decodeDdgRedirect(a[1] ?? "");
		const title = stripHtml(a[2] ?? "");
		const snippetMatch = block.match(SNIPPET_RE);
		const snippet = snippetMatch ? stripHtml(snippetMatch[1] ?? "") : "";
		if (!title || !href) continue;
		elements.push({
			textContent: `${title} ${snippet}`,
			getAttribute: () => null,
			querySelector(sel: string) {
				if (sel === "a.result__a") {
					return {
						textContent: title,
						getAttribute: (n: string) => (n === "href" ? href : null),
						querySelector: () => null,
					};
				}
				if (
					sel === "a.result__snippet" ||
					sel === ".result__snippet" ||
					sel === "a.result__snippet, .result__snippet"
				) {
					return {
						textContent: snippet,
						getAttribute: () => null,
						querySelector: () => null,
					};
				}
				return null;
			},
		});
	}
	return elements;
}
