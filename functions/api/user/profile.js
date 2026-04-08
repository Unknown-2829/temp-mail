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
        photoURL: user.photoURL || null,
        authProviders: user.authProviders || (user.passwordHash ? ['password'] : []),
        hasEmail: !!user.email,
        emailVerified: !!user.emailVerified,
        maskedEmail: user.email ? maskEmail(user.email) : null
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

    const { oldPassword, newPassword, isGoogleUser, addEmail, emailOtp, otpToken, photoURL } = body;

    // ── Avatar update ──────────────────────────────────────────────
    if (photoURL !== undefined) {
        // photoURL can be null (remove) or a URL string (set)
        if (photoURL !== null && typeof photoURL !== 'string') {
            return jsonResponse({ error: 'Invalid photoURL' }, 400);
        }
        user.photoURL = photoURL || null;
        await env.EMAILS.put(session.username, JSON.stringify(user));
        return jsonResponse({ success: true });
    }

    // ── Add / verify recovery email ────────────────────────────────
    if (addEmail) {
        if (!emailOtp || !otpToken) {
            return jsonResponse({ error: 'OTP code and token are required' }, 400);
        }
        const otpKey = `otp:${otpToken}`;
        const otpRaw = await env.EMAILS.get(otpKey);
        if (!otpRaw) return jsonResponse({ error: 'Invalid or expired verification code' }, 400);
        const otpData = JSON.parse(otpRaw);
        if (otpData.type !== 'add_email') return jsonResponse({ error: 'Invalid verification token' }, 400);
        if (Date.now() > otpData.expiresAt) {
            await env.EMAILS.delete(otpKey);
            return jsonResponse({ error: 'Verification code has expired' }, 400);
        }
        if (otpData.attempts >= 5) {
            await env.EMAILS.delete(otpKey);
            return jsonResponse({ error: 'Too many wrong attempts. Request a new code.' }, 400);
        }
        if (!constantTimeEqual(otpData.code, String(emailOtp).trim())) {
            otpData.attempts += 1;
            await env.EMAILS.put(otpKey, JSON.stringify(otpData), { expirationTtl: 600 });
            const remaining = 5 - otpData.attempts;
            return jsonResponse({
                error: remaining > 0
                    ? `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
                    : 'Too many wrong attempts. Request a new code.'
            }, 400);
        }
        // OTP valid — save email
        user.email = otpData.email;
        user.emailVerified = true;
        await env.EMAILS.delete(otpKey);
        await env.EMAILS.put(session.username, JSON.stringify(user));
        return jsonResponse({ success: true, maskedEmail: maskEmail(otpData.email) });
    }

    // ── Password change ────────────────────────────────────────────
    if (!newPassword) return jsonResponse({ error: 'New password is required' }, 400);
    if (newPassword.length < 8) return jsonResponse({ error: 'New password must be at least 8 characters' }, 400);

    // Google-only users: set a password without needing an old one
    const isGoogle = isGoogleUser ||
        (Array.isArray(user.authProviders) && user.authProviders.includes('google') && !user.passwordHash);

    if (!isGoogle) {
        if (!oldPassword) return jsonResponse({ error: 'Old and new passwords are required' }, 400);
        const oldHash = await hashPassword(oldPassword, user.salt);
        if (oldHash !== user.passwordHash) return jsonResponse({ error: 'Incorrect current password' }, 401);
        if (oldPassword === newPassword) return jsonResponse({ error: 'New password must be different from the current password' }, 400);
    }

    // Update password with a fresh salt
    const newSalt = crypto.randomUUID().replace(/-/g, '');
    const newHash = await hashPassword(newPassword, newSalt);
    user.passwordHash = newHash;
    user.salt = newSalt;
    // Add 'password' to authProviders if not already present
    if (!user.authProviders) user.authProviders = [];
    if (!user.authProviders.includes('password')) user.authProviders.push('password');
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

    const { password, googleDelete } = body;

    // Google-only users (no passwordHash) can delete without password
    const isGoogleOnly = Array.isArray(user.authProviders)
        ? user.authProviders.includes('google') && !user.authProviders.includes('password')
        : !user.passwordHash;

    if (!isGoogleOnly && !googleDelete) {
        if (!password) return jsonResponse({ error: 'Password is required to delete your account' }, 400);
        const hash = await hashPassword(password, user.salt);
        if (hash !== user.passwordHash) return jsonResponse({ error: 'Incorrect password' }, 401);
    }

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

function constantTimeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

function maskEmail(email) {
    const [local, domain] = email.split('@');
    if (local.length <= 2) return `${local[0]}*@${domain}`;
    return `${local[0]}${'*'.repeat(Math.min(local.length - 2, 4))}${local[local.length - 1]}@${domain}`;
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}
