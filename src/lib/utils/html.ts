import { stripTags } from './text';

/** Elements that end a line, which `textContent` alone would run into the next one. */
const LINE_ENDS = 'p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote, pre, table, ul, ol';

export function htmlToPlainText(html: string): string {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	// Their text is code, not words: a hand-written message's CSS would otherwise lead its plain-text copy.
	for (const code of doc.body.querySelectorAll('style, script, template')) code.remove();
	for (const br of doc.body.querySelectorAll('br')) br.replaceWith('\n');
	for (const block of doc.body.querySelectorAll(LINE_ENDS)) block.append('\n');
	for (const cell of doc.body.querySelectorAll('td, th')) cell.append(' ');
	return (doc.body.textContent ?? '')
		.split('\n')
		.map((line) => line.trimEnd())
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** Decode tags and whitespace entities when DOMParser is unavailable (SSR). */
function stripMarkup(html: string): string {
	return stripTags(html).replace(/&nbsp;/gi, ' ').replace(
		/&#(x)?([0-9a-f]+);/gi,
		(_match, hex: string | undefined, value: string) => {
			const code = Number.parseInt(value, hex ? 16 : 10);
			return Number.isNaN(code) ? '' : String.fromCharCode(code);
		}
	);
}

export function isHtmlEmpty(html: string): boolean {
	if (!html.trim()) return true;
	if (html.includes('<img')) return false;
	// Derived emptiness is evaluated during SSR, where DOMParser is unavailable.
	if (typeof DOMParser === 'undefined') {
		return !stripMarkup(html).trim();
	}
	return !htmlToPlainText(html);
}

export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
