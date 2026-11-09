import type { RequestHandler } from '@sveltejs/kit';
import { signatureImageResponse } from '$lib/server/signature-images';

/** Public on purpose: recipients' mail apps load signature images without signing in. */
export const GET: RequestHandler = async ({ params, platform }) => {
	const bucket = platform?.env.ATTACHMENTS;
	if (!bucket) return new Response('Not found', { status: 404 });
	return signatureImageResponse(bucket, params.name ?? '');
};
