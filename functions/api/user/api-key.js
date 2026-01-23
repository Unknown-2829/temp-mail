/**
 * API Key Management (Premium Feature)
 * GET /api/user/api-key - Get current API key
 * POST /api/user/api-key - Generate new API key
 */

export async function onRequest(context) {
    const { request, env } = context;

    // Verify auth token
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const session = await env.SESSIONS.get(token, { type: 'json' });
    if (!session || session.expiresAt < Date.now()) {
        return jsonResponse({ error: 'Session expired' }, 401);
    }

    const user = await env.USERS.get(session.email, { type: 'json' });
    if (!user) {
        return jsonResponse({ error: 'User not found' }, 404);
    }

    switch (request.method) {
        case 'GET':
            return handleGet(user);
        case 'POST':
            return handlePost(user, env, session.email);
        default:
            return jsonResponse({ error: 'Method not allowed' }, 405);
    }
}

async function handleGet(user) {
    if (!user.apiKey) {
        return jsonResponse({ apiKey: null, message: 'No API key generated' });
    }

    return jsonResponse({
        apiKey: user.apiKey,
        isPremium: user.isPremium,
        rateLimit: user.isPremium ? 10000 : 100
    });
}

async function handlePost(user, env, userEmail) {
    // Delete old API key if exists
    if (user.apiKey) {
        await env.API_KEYS.delete(user.apiKey);
    }

    // Generate new API key
    const newKey = generateApiKey();

    // Store API key data
    await env.API_KEYS.put(newKey, JSON.stringify({
        userId: userEmail,
        isPremium: user.isPremium,
        createdAt: Date.now()
    }));

    // Update user
    user.apiKey = newKey;
    await env.USERS.put(userEmail, JSON.stringify(user));

    return jsonResponse({
        success: true,
        apiKey: newKey,
        isPremium: user.isPremium,
        rateLimit: user.isPremium ? 10000 : 100
    });
}

function generateApiKey() {
    const prefix = 'tm_';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let key = prefix;
    for (let i = 0; i < 32; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        }
    });
}
