/**
 * Reset Password via OTP
 * POST /api/auth/reset-password
 * Body: { otpToken, code, newPassword }
 */

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const { otpToken, code, newPassword } = await request.json();

        if (!otpToken || !code || !newPassword) {
            return jsonResponse({ error: 'Missing required fields' }, 400);
        }
        if (newPassword.length < 8) {
            return jsonResponse({ error: 'Password must be at least 8 characters' }, 400);
        }

        const otpKey = `otp:${otpToken}`;
        const otpRaw = await env.EMAILS.get(otpKey);
        if (!otpRaw) {
            return jsonResponse({ error: 'Invalid or expired reset code' }, 400);
        }

        const otpData = JSON.parse(otpRaw);

        if (otpData.type !== 'password_reset') {
            return jsonResponse({ error: 'Invalid reset token' }, 400);
        }
        if (Date.now() > otpData.expiresAt) {
            await env.EMAILS.delete(otpKey);
            return jsonResponse({ error: 'Reset code has expired' }, 400);
        }
        if (otpData.attempts >= 5) {
            await env.EMAILS.delete(otpKey);
            return jsonResponse({ error: 'Too many wrong attempts. Please request a new code.' }, 400);
        }

        if (!constantTimeEqual(otpData.code, String(code).trim())) {
            otpData.attempts += 1;
            await env.EMAILS.put(otpKey, JSON.stringify(otpData), { expirationTtl: 600 });
            const remaining = 5 - otpData.attempts;
            return jsonResponse({
                error: remaining > 0
                    ? `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
                    : 'Too many wrong attempts. Please request a new code.'
            }, 400);
        }

        // OTP valid — hash new password and update user
        const user = await env.EMAILS.get(otpData.userKey, { type: 'json' });
        if (!user) {
            return jsonResponse({ error: 'User not found' }, 404);
        }

        const salt = crypto.randomUUID().replace(/-/g, '');
        const passwordHash = await hashPassword(newPassword, salt);

        user.passwordHash = passwordHash;
        user.salt = salt;
        if (!Array.isArray(user.authProviders)) {
            user.authProviders = [];
        }
        if (!user.authProviders.includes('password')) {
            user.authProviders.push('password');
        }

        await env.EMAILS.put(otpData.userKey, JSON.stringify(user));
        await env.EMAILS.delete(otpKey);

        return jsonResponse({ success: true });

    } catch (error) {
        return jsonResponse({ error: 'Server error' }, 500);
    }
}

function constantTimeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
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
