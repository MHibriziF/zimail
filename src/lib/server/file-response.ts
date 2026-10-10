import { inlineContentType } from '$lib/utils/attachments';

/**
 * Sent with every stored file. The type comes from whoever sent or uploaded it,
 * so the browser must neither sniff it into something else nor let it run.
 */
export const STORED_FILE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
	'X-Content-Type-Options': 'nosniff',
	'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox"
};

export type StoredFileHeaders = {
	contentType: string;
	size: number;
	cacheControl: string;
	filename?: string;
	/** False forces a download even for a type that could be shown inline. */
	allowInline?: boolean;
};

/**
 * Inline only for an allowlisted type, served under its normalized name rather
 * than the stored string; everything else downloads as an opaque byte stream.
 */
export function storedFileHeaders(file: StoredFileHeaders): Record<string, string> {
	const inlineType = file.allowInline === false ? null : inlineContentType(file.contentType);
	const disposition = inlineType ? 'inline' : 'attachment';
	const filename = file.filename === undefined ? '' : `; filename="${encodeURIComponent(file.filename)}"`;

	return {
		'Content-Type': inlineType ?? 'application/octet-stream',
		'Content-Disposition': `${disposition}${filename}`,
		'Content-Length': String(file.size),
		'Cache-Control': file.cacheControl,
		...STORED_FILE_SECURITY_HEADERS
	};
}
