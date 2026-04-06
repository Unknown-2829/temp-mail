/**
 * User Avatar Upload
 * POST /api/user/avatar  — multipart/form-data with field "file" (image, max 2 MB)
 * Returns { success: true, photoURL }
 */

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization'
        }
    });
}

export async function onRequestPost(context) {
    const { request, env } = context;

    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return jsonResponse({ error: 'Unauthorized' }, 401);

    const session = await env.EMAILS.get(`session:${token}`, { type: 'json' });
    if (!session || session.expiresAt < Date.now()) return jsonResponse({ error: 'Session expired' }, 401);

    const user = await env.EMAILS.get(session.username, { type: 'json' });
    if (!user) return jsonResponse({ error: 'User not found' }, 404);

    let formData;
    try {
        formData = await request.formData();
    } catch {
        return jsonResponse({ error: 'Invalid form data' }, 400);
    }

    const file = formData.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') {
        return jsonResponse({ error: 'No file provided' }, 400);
    }

    if (!file.type.startsWith('image/')) {
        return jsonResponse({ error: 'Only image files are allowed' }, 400);
    }

    if (file.size > 2 * 1024 * 1024) {
        return jsonResponse({ error: 'Image must be under 2 MB' }, 400);
    }

    // Build a safe R2 key from the user key (strip "user:" prefix)
    const userId = session.username.replace(/^user:/, '').replace(/[^a-zA-Z0-9@._-]/g, '_');
    const rawExt = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const safeExt = /^[a-z0-9]{1,5}$/.test(rawExt) ? rawExt : 'jpg';
    const r2Key = `avatars/${userId}.${safeExt}`;

    const buffer = await file.arrayBuffer();
    await env.ATTACHMENTS.put(r2Key, buffer, {
        httpMetadata: { contentType: file.type }
    });

    const photoURL = `/api/avatar?key=${encodeURIComponent(r2Key)}`;
    user.photoURL = photoURL;
    await env.EMAILS.put(session.username, JSON.stringify(user));

    return jsonResponse({ success: true, photoURL });
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}
