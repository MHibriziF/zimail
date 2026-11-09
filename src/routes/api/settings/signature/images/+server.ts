import { json, type RequestHandler } from '@sveltejs/kit';
import { MAX_SIGNATURE_IMAGE_BYTES, saveSignatureImage, SIGNATURE_IMAGE_PATH } from '$lib/server/signature-images';

/** Takes the image file as the request body and answers with the public URL to put in the signature. */
export const POST: RequestHandler = async ({ request, locals, platform, url }) => {
	const bucket = platform?.env.ATTACHMENTS;
	if (!bucket || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const declared = Number(request.headers.get('content-length') ?? 0);
	if (declared > MAX_SIGNATURE_IMAGE_BYTES) return json({ error: 'too_large' }, { status: 413 });

	const saved = await saveSignatureImage(bucket, new Uint8Array(await request.arrayBuffer()));
	if (!saved.ok) return json({ error: saved.error }, { status: saved.error === 'too_large' ? 413 : 400 });
	return json({ url: `${url.origin}${SIGNATURE_IMAGE_PATH}${saved.name}` });
};
