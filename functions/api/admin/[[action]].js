/**
 * Admin API - Protected by ADMIN_SECRET env variable
 * POST /api/admin/login         - { secret } → returns adminToken
 * GET  /api/admin/user          - ?username=xxx → user info
 * POST /api/admin/grant-premium - { username, adminToken, days? }
 * POST /api/admin/revoke-premium- { username, adminToken }
 * GET  /api/admin/stats         - admin stats
 */

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    // Extract action from path: /api/admin/login → "login"
    const parts = url.pathname.split('/').filter(Boolean);
    const action = parts[parts.length - 1];

    // Allow OPTIONS (CORS preflight)
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders() });
    }

    // Login doesn't require admin token
    if (action === 'login' && request.method === 'POST') {
        return handleLogin(request, env);
    }

    // All other routes require valid admin token
    const adminToken = request.headers.get('X-Admin-Token') ||
        (request.method !== 'GET' ? (await request.clone().json().catch(() => ({}))).adminToken : null) ||
        url.searchParams.get('adminToken');

    const isAuthed = await verifyAdminToken(adminToken, env);
    if (!isAuthed) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    switch (action) {
        case 'user':
            return handleGetUser(url, env);
        case 'grant-premium':
            return handleGrantPremium(request, env);
        case 'revoke-premium':
            return handleRevokePremium(request, env);
        case 'stats':
            return handleStats(env);
        default:
            return jsonResponse({ error: 'Unknown action' }, 404);
    }
}

// ===== Login =====
async function handleLogin(request, env) {
    const { secret } = await request.json();
    if (!secret || secret !== env.ADMIN_SECRET) {
        return jsonResponse({ error: 'Invalid secret' }, 401);
    }

    const adminToken = 'adm_' + Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, '0')).join('');

    await env.ADMIN_SESSIONS.put(adminToken, JSON.stringify({
        createdAt: Date.now(),
        expiresAt: Date.now() + 2 * 60 * 60 * 1000 // 2 hours
    }), { expirationTtl: 7200 });

    return jsonResponse({ success: true, adminToken });
}

// ===== Verify Admin Token =====
async function verifyAdminToken(token, env) {
    if (!token) return false;
    const session = await env.ADMIN_SESSIONS.get(token, { type: 'json' });
    if (!session) return false;
    if (session.expiresAt < Date.now()) {
        await env.ADMIN_SESSIONS.delete(token);
        return false;
    }
    return true;
}

// ===== Get User =====
async function handleGetUser(url, env) {
    const username = url.searchParams.get('username')?.toLowerCase();
    if (!username) return jsonResponse({ error: 'username required' }, 400);

    const user = await env.USERS.get(username, { type: 'json' });
    if (!user) return jsonResponse({ error: 'User not found' }, 404);

    // Return safe user info (no password hash/salt)
    return jsonResponse({
        username: user.username,
        email: user.email || null,
        createdAt: user.createdAt,
        isPremium: user.isPremium,
        premiumExpiry: user.premiumExpiry,
        savedEmails: (user.savedEmails || []).length,
        hasApiKey: !!user.apiKey
    });
}

// ===== Grant Premium =====
async function handleGrantPremium(request, env) {
    const { username, days = 365 } = await request.json();
    if (!username) return jsonResponse({ error: 'username required' }, 400);

    const userKey = username.toLowerCase();
    const user = await env.USERS.get(userKey, { type: 'json' });
    if (!user) return jsonResponse({ error: 'User not found' }, 404);

    user.isPremium = true;
    user.premiumExpiry = Date.now() + days * 24 * 60 * 60 * 1000;
    user.premiumGrantedAt = Date.now();

    await env.USERS.put(userKey, JSON.stringify(user));

    return jsonResponse({
        success: true,
        message: `Premium granted to @${userKey} for ${days} days`,
        premiumExpiry: new Date(user.premiumExpiry).toISOString()
    });
}

// ===== Revoke Premium =====
async function handleRevokePremium(request, env) {
    const { username } = await request.json();
    if (!username) return jsonResponse({ error: 'username required' }, 400);

    const userKey = username.toLowerCase();
    const user = await env.USERS.get(userKey, { type: 'json' });
    if (!user) return jsonResponse({ error: 'User not found' }, 404);

    user.isPremium = false;
    user.premiumExpiry = null;
    await env.USERS.put(userKey, JSON.stringify(user));

    return jsonResponse({ success: true, message: `Premium revoked from @${userKey}` });
}

// ===== Stats =====
async function handleStats(env) {
    try {
        const list = await env.USERS.list({ limit: 1000 });
        let premiumCount = 0;
        let total = list.keys.length;

        for (const key of list.keys) {
            const user = await env.USERS.get(key.name, { type: 'json' });
            if (user?.isPremium) premiumCount++;
        }

        return jsonResponse({ total, premium: premiumCount, free: total - premiumCount });
    } catch (e) {
        return jsonResponse({ total: '?', premium: '?', free: '?' });
    }
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token'
    };
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
}
