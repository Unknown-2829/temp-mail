/**
 * Signin - Username/Password Auth
 * POST /api/auth/signin
 * Body: { username, password }
 */

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const { username, password } = await request.json();

        if (!username || !password) {
            return jsonResponse({ error: 'Username and password required' }, 400);
        }

        const userKey = username.toLowerCase();
        const user = await env.USERS.get(userKey, { type: 'json' });

        if (!user) {
            return jsonResponse({ error: 'Invalid username or password' }, 401);
        }

        // Hash provided password with stored salt and compare
        const passwordHash = await hashPassword(password, user.salt);
        if (passwordHash !== user.passwordHash) {
            return jsonResponse({ error: 'Invalid username or password' }, 401);
        }

        // Check premium expiry
        let isPremium = user.isPremium;
        if (isPremium && user.premiumExpiry && user.premiumExpiry < Date.now()) {
            // Premium expired — update user
            user.isPremium = false;
            user.premiumExpiry = null;
            await env.USERS.put(userKey, JSON.stringify(user));
            isPremium = false;
        }

        // Create session
        const token = generateToken();
        const sessionData = {
            username: userKey,
            createdAt: Date.now(),
            expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000)
        };
        await env.SESSIONS.put(token, JSON.stringify(sessionData), {
            expirationTtl: 7 * 24 * 60 * 60
        });

        return jsonResponse({ success: true, token, username: userKey, isPremium });

    } catch (error) {
        console.error('Signin error:', error);
        return jsonResponse({ error: 'Server error' }, 500);
    }
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

function generateToken() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 64; i++) token += chars.charAt(Math.floor(Math.random() * chars.length));
    return token;
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}
