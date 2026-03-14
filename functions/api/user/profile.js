/**
 * User Profile (Read-only premium status check)
 * GET /api/user/profile - Returns username and current premium status
 */

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
        premiumExpiry: user.premiumExpiry || null
    });
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}
