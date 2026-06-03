// Minimal element stub used by google-adapter-parser.spec.ts. Mimics just the
// Element surface the adapter's $$eval callback reads: querySelector /
// textContent / getAttribute. Regex-parse is sufficient for deterministic
// synthetic fixtures; matches the pattern established by _ddg-fixture-parser.ts.
// Real-DOM validation is deferred to integration tests (see spec §10).

export interface ElementStub {
	querySelector(selector: string): ElementStub | null;
	textContent: string;
	getAttribute(name: string): string | null;
}

const BLOCK_SPLIT_RE = /(?=<div[^>]*\bdata-sokoban-container=)/gi;
const HAS_SOKOBAN_RE = /\bdata-sokoban-container=/i;
const A_HAS_JSNAME_RE = /<a\b[^>]*\bjsname="[^"]*"[^>]*>[\s\S]*?<\/a>/i;
const A_HREF_RE = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
const H3_RE = /<h3[^>]*>([\s\S]*?)<\/h3>/i;
const SNIPPET_SNCF_RE = /<div[^>]*\bdata-sncf=[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i;
const SNIPPET_CLAMP_RE = /<div[^>]*\bstyle="[^"]*-webkit-line-clamp[^"]*"[^>]*>([\s\S]*?)<\/div>/i;

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

export function parseGoogleFixture(html: string, selector: string): ElementStub[] {
	// Only the parser's container selector is supported; other selectors return empty.
	if (selector !== "div#search div[data-sokoban-container]") return [];
	const parts = html.split(BLOCK_SPLIT_RE).filter((b) => HAS_SOKOBAN_RE.test(b));
	const elements: ElementStub[] = [];
	for (const block of parts) {
		const h3m = block.match(H3_RE);
		const aHasJsname = A_HAS_JSNAME_RE.test(block);
		const am = aHasJsname ? block.match(A_HREF_RE) : null;
		const sn = block.match(SNIPPET_SNCF_RE) ?? block.match(SNIPPET_CLAMP_RE);
		const title = h3m ? stripHtml(h3m[1] ?? "") : "";
		const href = am ? (am[1] ?? "") : "";
		const snippet = sn ? stripHtml(sn[1] ?? "") : "";
		elements.push({
			textContent: "",
			getAttribute: () => null,
			querySelector(sel: string) {
				if (sel === "h3") {
					return {
						textContent: title,
						getAttribute: () => null,
						querySelector: () => null,
					};
				}
				if (sel === "a[jsname]") {
					return {
						textContent: "",
						getAttribute: (n: string) => (n === "href" ? href : null),
						querySelector: () => null,
					};
				}
				if (sel === "div[data-sncf] span" || sel === 'div[style*="-webkit-line-clamp"]') {
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
