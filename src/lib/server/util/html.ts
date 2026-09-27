import { removeElements, stripTags } from '../../utils/text';

/**
 * Server-side HTML → plain text, for text bodies — never inserted as HTML. The
 * browser helper in $lib/utils/html.ts uses DOMParser, which does not exist in
 * the Workers runtime.
 */
export function stripHtml(html: string): string {
	const withBreaks = removeElements(removeElements(html, 'style'), 'script')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n');
	return (
		stripTags(withBreaks)
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
