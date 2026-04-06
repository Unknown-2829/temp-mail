/**
 * User Profile
 * GET    /api/user/profile  - Returns username and current premium status
 * PATCH  /api/user/profile  - Change password (body: { oldPassword, newPassword })
 * DELETE /api/user/profile  - Delete account   (body: { password })
 */

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, PATCH, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
    });
}

export async function onRequestGet(context) {
    const { request, env } = context;

    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return jsonResponse({ error: 'Unauthorized' }, 401);

    const session = await env.EMAILS.get(`session:${token}`, { type: 'json' });
    if (!session || session.expiresAt < Date.now()) return jsonResponse({ error: 'Session expired' }, 401);

    const user = await env.EMAILS.get(session.username, { type: 'json' });
    if (!user) return jsonResponse({ error: 'User not found' }, 404);

    // Check premium expiry and update if necessary
    let isPremium = user.isPremium;
    if (isPremium && user.premiumExpiry && user.premiumExpiry < Date.now()) {
        user.isPremium = false;
        user.premiumExpiry = null;
        await env.EMAILS.put(session.username, JSON.stringify(user));
        isPremium = false;
    }

    const username = user.displayUsername || (session.username.replace(/^user:/, ''));

    return jsonResponse({
        username,
        isPremium,
        premiumExpiry: user.premiumExpiry || null,
        photoURL: user.photoURL || null
    });
}

export async function onRequestPatch(context) {
    const { request, env } = context;

    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return jsonResponse({ error: 'Unauthorized' }, 401);

    const session = await env.EMAILS.get(`session:${token}`, { type: 'json' });
    if (!session || session.expiresAt < Date.now()) return jsonResponse({ error: 'Session expired' }, 401);

    const user = await env.EMAILS.get(session.username, { type: 'json' });
    if (!user) return jsonResponse({ error: 'User not found' }, 404);

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }

    const { oldPassword, newPassword } = body;
    if (!oldPassword || !newPassword) return jsonResponse({ error: 'Old and new passwords are required' }, 400);
    if (newPassword.length < 8) return jsonResponse({ error: 'New password must be at least 8 characters' }, 400);

    // Verify old password first, then validate new password
    const oldHash = await hashPassword(oldPassword, user.salt);
    if (oldHash !== user.passwordHash) return jsonResponse({ error: 'Incorrect current password' }, 401);

    if (oldPassword === newPassword) return jsonResponse({ error: 'New password must be different from the current password' }, 400);

    // Update password with a fresh salt
    const newSalt = crypto.randomUUID().replace(/-/g, '');
    const newHash = await hashPassword(newPassword, newSalt);
    user.passwordHash = newHash;
    user.salt = newSalt;
    await env.EMAILS.put(session.username, JSON.stringify(user));

    return jsonResponse({ success: true });
}

export async function onRequestDelete(context) {
    const { request, env } = context;

    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return jsonResponse({ error: 'Unauthorized' }, 401);

    const session = await env.EMAILS.get(`session:${token}`, { type: 'json' });
    if (!session || session.expiresAt < Date.now()) return jsonResponse({ error: 'Session expired' }, 401);

    const user = await env.EMAILS.get(session.username, { type: 'json' });
    if (!user) return jsonResponse({ error: 'User not found' }, 404);

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }

    const { password } = body;
    if (!password) return jsonResponse({ error: 'Password is required to delete your account' }, 400);

    // Verify password before deletion
    const hash = await hashPassword(password, user.salt);
    if (hash !== user.passwordHash) return jsonResponse({ error: 'Incorrect password' }, 401);

    // Delete user record, current session, and all standalone email address records
    const savedEmails = user.savedEmails || [];
    await Promise.all([
      env.EMAILS.delete(session.username),
      env.EMAILS.delete(`session:${token}`),
      ...savedEmails.map(e => env.EMAILS.delete(e.address))
    ]);

    return jsonResponse({ success: true });
}

async function hashPassword(password, salt) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' },
        keyMaterial,
        256
    );
    return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}
