/**
 * API Key Management (Premium Feature)
 * GET /api/user/api-key - Get current API key
 * POST /api/user/api-key - Generate new API key
 */

export async function onRequest(context) {
    const { request, env } = context;

    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return jsonResponse({ error: 'Unauthorized' }, 401);

    const session = await env.EMAILS.get(`session:${token}`, { type: 'json' });
    if (!session || session.expiresAt < Date.now()) return jsonResponse({ error: 'Session expired' }, 401);

    const user = await env.EMAILS.get(session.username, { type: 'json' });
    if (!user) return jsonResponse({ error: 'User not found' }, 404);

    switch (request.method) {
        case 'GET': return handleGet(user);
        case 'POST': return handlePost(user, env, session.username);
        default: return jsonResponse({ error: 'Method not allowed' }, 405);
    }
}

async function handleGet(user) {
    if (!user.apiKey) return jsonResponse({ apiKey: null, message: 'No API key generated' });
    return jsonResponse({ apiKey: user.apiKey, isPremium: user.isPremium, rateLimit: user.isPremium ? 10000 : 100 });
}

async function handlePost(user, env, username) {
    // API key info (userId, isPremium, rateLimit) is accessible via the user object,
    // so we store the key alongside the user record rather than a separate KV binding.
    const newKey = generateApiKey();

    user.apiKey = newKey;
    user.apiKeyCreatedAt = Date.now();
    await env.EMAILS.put(username, JSON.stringify(user));

    return jsonResponse({ success: true, apiKey: newKey, isPremium: user.isPremium, rateLimit: user.isPremium ? 10000 : 100 });
}

function generateApiKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let key = 'pm_'; // pm = Phantom Mail
    for (let i = 0; i < 32; i++) key += chars.charAt(Math.floor(Math.random() * chars.length));
    return key;
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}
