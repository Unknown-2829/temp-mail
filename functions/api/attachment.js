export async function onRequestGet(context) {
    const { request, env } = context;
    const key = new URL(request.url).searchParams.get('key');

    if (!key || !key.startsWith('attachments/')) {
        return new Response('Forbidden', { status: 403 });
    }

    const obj = await env.ATTACHMENTS.get(key);
    if (!obj) return new Response('Not Found', { status: 404 });

    // Extract original filename from R2 key: attachments/{addr}/{timestamp}_{idx}_{filename}
    const keyParts = key.split('/');
    const lastPart = keyParts[keyParts.length - 1];
    // Strip leading {timestamp}_{idx}_ prefix
    const filename = lastPart.replace(/^\d+_\d+_/, '');

    return new Response(obj.body, {
        headers: {
            'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'private, max-age=3600'
        }
    });
}
