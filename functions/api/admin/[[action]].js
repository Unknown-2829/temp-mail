/**
 * Admin API - Protected by ADMIN_SECRET env variable
 * POST /api/admin/login         - { secret } → returns adminToken
 * GET  /api/admin/user          - ?username=xxx → user info
 * GET  /api/admin/list-users    - ?cursor=&filter=all|premium|free → paginated user list
 * POST /api/admin/grant-premium - { username, adminToken, days? }
 * POST /api/admin/revoke-premium- { username, adminToken }
 * GET  /api/admin/stats         - admin stats
 *
 * All user data lives in env.EMAILS with prefix "user:{username}".
 * Admin sessions live in env.EMAILS with prefix "admin_session:{token}".
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
        case 'list-users':
            return handleListUsers(url, env);
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

    await env.EMAILS.put(`admin_session:${adminToken}`, JSON.stringify({
        createdAt: Date.now(),
        expiresAt: Date.now() + 2 * 60 * 60 * 1000 // 2 hours
    }), { expirationTtl: 7200 });

    return jsonResponse({ success: true, adminToken });
}

// ===== Verify Admin Token =====
async function verifyAdminToken(token, env) {
    if (!token) return false;
    const session = await env.EMAILS.get(`admin_session:${token}`, { type: 'json' });
    if (!session) return false;
    if (session.expiresAt < Date.now()) {
        await env.EMAILS.delete(`admin_session:${token}`);
        return false;
    }
    return true;
}

// ===== Get User =====
async function handleGetUser(url, env) {
    const username = url.searchParams.get('username')?.toLowerCase();
    if (!username) return jsonResponse({ error: 'username required' }, 400);

    const user = await env.EMAILS.get(`user:${username}`, { type: 'json' });
    if (!user) return jsonResponse({ error: 'User not found' }, 404);

    return jsonResponse(safeUser(user));
}

// ===== List Users =====
async function handleListUsers(url, env) {
    try {
        const cursor = url.searchParams.get('cursor') || undefined;
        const filter = url.searchParams.get('filter') || 'all'; // all | premium | free
        const limit = 50;

        const list = await env.EMAILS.list({ prefix: 'user:', limit, cursor });

        const users = (await Promise.all(
            list.keys.map(async (key) => {
                const user = await env.EMAILS.get(key.name, { type: 'json' });
                if (!user) return null;
                return safeUser(user);
            })
        )).filter(Boolean);

        const filtered = filter === 'premium'
            ? users.filter(u => u.isPremium)
            : filter === 'free'
                ? users.filter(u => !u.isPremium)
                : users;

        return jsonResponse({
            users: filtered,
            cursor: list.cursor || null,
            hasMore: !list.complete
        });
    } catch (e) {
        return jsonResponse({ error: 'Failed to list users' }, 500);
    }
}

// ===== Grant Premium =====
async function handleGrantPremium(request, env) {
    const { username, days = 365 } = await request.json();
    if (!username) return jsonResponse({ error: 'username required' }, 400);

    const userKey = `user:${username.toLowerCase()}`;
    const user = await env.EMAILS.get(userKey, { type: 'json' });
    if (!user) return jsonResponse({ error: 'User not found' }, 404);

    user.isPremium = true;
    user.premiumExpiry = Date.now() + days * 24 * 60 * 60 * 1000;
    user.premiumGrantedAt = Date.now();

    await env.EMAILS.put(userKey, JSON.stringify(user));

    // Keep API_KEYS entry in sync so rate limit takes effect immediately
    if (user.apiKey && env.API_KEYS) {
        const keyData = await env.API_KEYS.get(user.apiKey, { type: 'json' }).catch(() => null);
        if (keyData) {
            keyData.isPremium = true;
            await env.API_KEYS.put(user.apiKey, JSON.stringify(keyData)).catch(() => {});
        }
    }

    return jsonResponse({
        success: true,
        message: `Premium granted to @${username.toLowerCase()} for ${days} days`,
        premiumExpiry: new Date(user.premiumExpiry).toISOString()
    });
}

// ===== Revoke Premium =====
async function handleRevokePremium(request, env) {
    const { username } = await request.json();
    if (!username) return jsonResponse({ error: 'username required' }, 400);

    const userKey = `user:${username.toLowerCase()}`;
    const user = await env.EMAILS.get(userKey, { type: 'json' });
    if (!user) return jsonResponse({ error: 'User not found' }, 404);

    user.isPremium = false;
    user.premiumExpiry = null;
    await env.EMAILS.put(userKey, JSON.stringify(user));

    // Keep API_KEYS entry in sync so rate limit takes effect immediately
    if (user.apiKey && env.API_KEYS) {
        const keyData = await env.API_KEYS.get(user.apiKey, { type: 'json' }).catch(() => null);
        if (keyData) {
            keyData.isPremium = false;
            await env.API_KEYS.put(user.apiKey, JSON.stringify(keyData)).catch(() => {});
        }
    }

    return jsonResponse({ success: true, message: `Premium revoked from @${username.toLowerCase()}` });
}

// ===== Stats =====
async function handleStats(env) {
    try {
        const list = await env.EMAILS.list({ prefix: 'user:', limit: 1000 });
        let premiumCount = 0;
        const total = list.keys.length;

        for (const key of list.keys) {
            const user = await env.EMAILS.get(key.name, { type: 'json' });
            if (user?.isPremium) premiumCount++;
        }

        return jsonResponse({ total, premium: premiumCount, free: total - premiumCount });
    } catch (e) {
        return jsonResponse({ total: '?', premium: '?', free: '?' });
    }
}

// ===== Helpers =====
function safeUser(user) {
    const rawName = user.username || '';
    const displayName = user.displayUsername || rawName.replace(/^user:/, '');
    return {
        username: displayName,
        email: user.email || null,
        createdAt: user.createdAt,
        isPremium: !!user.isPremium,
        premiumExpiry: user.premiumExpiry || null,
        premiumGrantedAt: user.premiumGrantedAt || null,
        savedEmails: (user.savedEmails || []).length,
        hasApiKey: !!user.apiKey
    };
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
