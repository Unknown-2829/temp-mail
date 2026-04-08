/**
 * Avatar Upload
 * POST /api/avatar-upload
 * Accepts multipart/form-data with an 'avatar' file field (image/*, max 2 MB).
 * Stores in ATTACHMENTS R2 under avatars/{userId}-{timestamp}.{ext}
 * Updates user.photoURL in KV and returns the public URL.
 * Requires Bearer token.
 */

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const EXT_MAP = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
    });
}

export async function onRequestPost(context) {
    const { request, env } = context;

    // Auth
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return jsonError('Unauthorized', 401);
    const session = await env.EMAILS.get(`session:${token}`, { type: 'json' });
    if (!session || session.expiresAt < Date.now()) return jsonError('Session expired', 401);

    const userKey = session.username;
    const user = await env.EMAILS.get(userKey, { type: 'json' });
    if (!user) return jsonError('User not found', 404);

    // Parse multipart
    let formData;
    try {
        formData = await request.formData();
    } catch {
        return jsonError('Expected multipart/form-data', 400);
    }

    const file = formData.get('avatar');
    if (!file || typeof file === 'string') return jsonError('No avatar file provided', 400);

    const contentType = file.type || 'image/jpeg';
    if (!ALLOWED_TYPES.has(contentType)) {
        return jsonError('Only JPEG, PNG, WebP, and GIF images are allowed', 400);
    }

    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_BYTES) {
        return jsonError('Image must be 2 MB or smaller', 413);
    }

    // Build a stable key: avatars/{userId}-{timestamp}.{ext}
    const userId = userKey.replace(/^user:/, '').replace(/[^a-zA-Z0-9_\-]/g, '_');
    const ext = EXT_MAP[contentType] || 'jpg';
    const r2Key = `avatars/${userId}-${Date.now()}.${ext}`;

    // Delete old avatar if any
    if (user.photoURL && user.photoURL.startsWith('/api/avatar?key=')) {
        const oldKey = decodeURIComponent(user.photoURL.replace('/api/avatar?key=', ''));
        try { await env.ATTACHMENTS.delete(oldKey); } catch { /* ignore */ }
    }

    // Upload to R2
    await env.ATTACHMENTS.put(r2Key, arrayBuffer, {
        httpMetadata: { contentType }
    });

    // Update user record
    const photoURL = `/api/avatar?key=${encodeURIComponent(r2Key)}`;
    user.photoURL = photoURL;
    await env.EMAILS.put(userKey, JSON.stringify(user));

    return new Response(JSON.stringify({ success: true, photoURL }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}

function jsonError(msg, status) {
    return new Response(JSON.stringify({ error: msg }), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}
