/**
 * Prose-aware keyword detection. Port of omp's `modes/ultrathink.ts` boundary
 * logic: a keyword only counts when it appears as a standalone word in prose —
 * not inside inline code, fenced code blocks, or HTML/XML tags.
 */

const FENCE_BLOCK = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g;
const INLINE_CODE = /`[^`\n]*`/g;
const ELEMENT = /<[^<>\/][^<>]*>[^<>]*<\/[^<>]*>/g;
const TAG = /<[^<>]*>/g;

/** Remove code spans, fenced blocks, and XML/HTML elements/tags; leave prose intact. */
export function stripCodeAndTags(text: string): string {
	return text
		.replace(FENCE_BLOCK, " ")
		.replace(INLINE_CODE, " ")
		.replace(ELEMENT, " ")
		.replace(TAG, " ")
		.replace(/\s+/g, " ");
}

/**
 * Whether `keyword` appears as a standalone word in prose.
 * Case-sensitive; the keyword must be bounded by non-word chars.
 */
export function containsProseKeyword(text: string, keyword: string): boolean {
	if (!keyword || !text) return false;
	const prose = stripCodeAndTags(text);
	const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(^|[^A-Za-z0-9_])${escaped}(?=$|[^A-Za-z0-9_])`).test(prose);
}

/** Extract every defined keyword present in prose. */
export function detectKeywords(text: string, keywords: string[]): string[] {
	const prose = stripCodeAndTags(text);
	return keywords.filter((k) => {
		const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		return new RegExp(`(^|[^A-Za-z0-9_])${escaped}(?=$|[^A-Za-z0-9_])`).test(prose);
	});
}
