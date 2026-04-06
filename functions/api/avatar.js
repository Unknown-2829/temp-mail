/**
 * Avatar Serving
 * GET /api/avatar?key=avatars/{userId}.{ext}
 * Serves user profile pictures from the ATTACHMENTS R2 bucket.
 */

export async function onRequestGet(context) {
    const { request, env } = context;
    const key = new URL(request.url).searchParams.get('key');

    if (!key || !key.startsWith('avatars/')) {
        return new Response('Forbidden', { status: 403 });
    }

    const obj = await env.ATTACHMENTS.get(key);
    if (!obj) return new Response('Not Found', { status: 404 });

    const contentType = obj.httpMetadata?.contentType || 'image/jpeg';

    return new Response(obj.body, {
        headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=86400',
            'Access-Control-Allow-Origin': '*'
        }
    });
}
