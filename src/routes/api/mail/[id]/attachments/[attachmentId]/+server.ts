import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAttachmentForUser, readAttachmentBytes } from '$lib/server/attachments';
import { storedFileHeaders } from '$lib/server/file-response';

export const GET: RequestHandler = async ({ params, locals, platform, url }) => {
	if (!locals.user || !platform?.env.DB || !platform?.env.ATTACHMENTS) {
		throw error(401, 'Unauthorized');
	}

	const attachment = await getAttachmentForUser(
		platform.env.DB,
		locals.user.id,
		params.id,
		params.attachmentId
	);

	if (!attachment) {
		throw error(404, 'Attachment not found');
	}

	const bytes = await readAttachmentBytes(platform.env.ATTACHMENTS, attachment);
	if (!bytes) {
		throw error(404, 'Attachment not found');
	}

	return new Response(new Uint8Array(bytes), {
		headers: storedFileHeaders({
			contentType: attachment.content_type,
			size: bytes.length,
			cacheControl: 'private, max-age=3600',
			filename: attachment.filename,
			allowInline: url.searchParams.get('download') !== '1'
		})
	});
};
