/**
 * Server-side HTML → plain text, for text bodies — never inserted as HTML. The
 * browser helper in $lib/utils/html.ts uses DOMParser, which does not exist in
 * the Workers runtime.
 */
export function stripHtml(html: string): string {
	return (
		html
			.replace(/<style[\s\S]*?<\/style>/gi, '')
			.replace(/<script[\s\S]*?<\/script>/gi, '')
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
			// `[^<>]` rather than `[^>]`: a run of unclosed `<` would otherwise backtrack quadratically.
			.replace(/<[^<>]*>/g, '')
			.replace(/&nbsp;/g, ' ')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			// Last, so `&amp;lt;` becomes the text `&lt;` rather than `<`.
			.replace(/&amp;/g, '&')
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
}
