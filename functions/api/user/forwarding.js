/**
 * Email Forwarding Management (Premium Feature)
 * POST /api/user/forwarding - Enable/disable forwarding
 * Body: { address: string, forwardTo: string | null }
 */

export async function onRequestPost(context) {
    const { request, env } = context;

    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return jsonResponse({ error: 'Unauthorized' }, 401);

    const session = await env.SESSIONS.get(token, { type: 'json' });
    if (!session || session.expiresAt < Date.now()) return jsonResponse({ error: 'Session expired' }, 401);

    const user = await env.USERS.get(session.username, { type: 'json' });
    if (!user || !user.isPremium) return jsonResponse({ error: 'Premium required' }, 403);

    try {
        const { address, forwardTo } = await request.json();
        if (!address) return jsonResponse({ error: 'Address required' }, 400);

        const savedEmails = user.savedEmails || [];
        const emailIndex = savedEmails.findIndex(e => e.address === address);
        if (emailIndex === -1) return jsonResponse({ error: 'Email not in saved list' }, 404);

        if (forwardTo && !forwardTo.includes('@')) return jsonResponse({ error: 'Invalid forwarding email' }, 400);

        savedEmails[emailIndex].forwarding = forwardTo || null;
        user.savedEmails = savedEmails;
        await env.USERS.put(session.username, JSON.stringify(user));

        const forwardingKey = `forward:${address}`;
        if (forwardTo) {
            await env.TEMP_EMAILS.put(forwardingKey, JSON.stringify({ to: forwardTo, userId: session.username, createdAt: Date.now() }));
        } else {
            await env.TEMP_EMAILS.delete(forwardingKey);
        }

        return jsonResponse({
            success: true,
            message: forwardTo ? `Forwarding enabled to ${forwardTo}` : 'Forwarding disabled',
            savedEmails
        });
    } catch (error) {
        return jsonResponse({ error: 'Server error' }, 500);
    }
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}
