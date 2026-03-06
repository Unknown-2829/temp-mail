/**
 * Signup - Username/Password Auth
 * POST /api/auth/signup
 * Body: { username, password, email? }
 */

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const { username, password, email } = await request.json();

        // Validate username
        if (!username || username.length < 3 || username.length > 20) {
            return jsonResponse({ error: 'Username must be 3-20 characters' }, 400);
        }
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            return jsonResponse({ error: 'Username can only contain letters, numbers, and underscores' }, 400);
        }

        // Validate password
        if (!password || password.length < 8) {
            return jsonResponse({ error: 'Password must be at least 8 characters' }, 400);
        }

        const userKey = `user:${username.toLowerCase()}`;

        // Check if username already taken
        const existing = await env.EMAILS.get(userKey);
        if (existing) {
            return jsonResponse({ error: 'Username already taken' }, 400);
        }

        // Hash password with PBKDF2 + random salt (Web Crypto API)
        const salt = crypto.randomUUID().replace(/-/g, '');
        const passwordHash = await hashPassword(password, salt);

        // Create user
        const user = {
            username: userKey,
            displayUsername: username,
            passwordHash,
            salt,
            email: email || null,
            createdAt: Date.now(),
            isPremium: false,
            premiumExpiry: null,
            savedEmails: [],
            apiKey: null
        };

        await env.EMAILS.put(userKey, JSON.stringify(user));

        // Create session
        const token = generateToken();
        const sessionData = {
            username: userKey,
            createdAt: Date.now(),
            expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000)
        };
        await env.EMAILS.put(`session:${token}`, JSON.stringify(sessionData), {
            expirationTtl: 7 * 24 * 60 * 60
        });

        return jsonResponse({ success: true, token, username: username.toLowerCase(), isPremium: false });

    } catch (error) {
        console.error('Signup error:', error);
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
