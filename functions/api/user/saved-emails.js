/**
 * Saved Emails Management (Premium Feature)
 * GET /api/user/saved-emails - Get user's saved emails
 * POST /api/user/saved-emails - Save an email (max 8)
 * DELETE /api/user/saved-emails - Remove a saved email
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

    // Check premium status
    if (!user.isPremium) {
        return jsonResponse({ error: 'Premium required' }, 403);
    }

    switch (request.method) {
        case 'GET':
            return handleGet(user, env);
        case 'POST':
            return handlePost(request, user, env, session.email);
        case 'DELETE':
            return handleDelete(request, user, env, session.email);
        default:
            return jsonResponse({ error: 'Method not allowed' }, 405);
    }
}

async function handleGet(user, env) {
    const savedEmails = user.savedEmails || [];

    // Fetch actual emails data for each saved address
    const emailsData = await Promise.all(
        savedEmails.map(async (savedEmail) => {
            const emails = [];
            const prefix = `email:${savedEmail.address}:`;
            const list = await env.EMAILS.list({ prefix });

            for (const key of list.keys) {
                const emailData = await env.EMAILS.get(key.name, { type: 'json' });
                if (emailData) emails.push(emailData);
            }

            return {
                ...savedEmail,
                emails: emails.sort((a, b) => b.timestamp - a.timestamp)
            };
        })
    );

    return jsonResponse({ savedEmails: emailsData });
}

async function handlePost(request, user, env, userEmail) {
    const { address, customName } = await request.json();

    if (!address || !address.includes('@')) {
        return jsonResponse({ error: 'Invalid email address' }, 400);
    }

    const savedEmails = user.savedEmails || [];

    // Max 8 saved emails
    if (savedEmails.length >= 8) {
        return jsonResponse({ error: 'Maximum 8 saved emails allowed' }, 400);
    }

    // Check if already saved
    if (savedEmails.some(e => e.address === address)) {
        return jsonResponse({ error: 'Email already saved' }, 400);
    }

    // Add to saved emails
    savedEmails.push({
        address,
        customName: customName || address.split('@')[0],
        savedAt: Date.now(),
        forwarding: null
    });

    user.savedEmails = savedEmails;
    await env.USERS.put(userEmail, JSON.stringify(user));

    // Register in TEMP_EMAILS without TTL (permanent)
    await env.TEMP_EMAILS.put(address, JSON.stringify({
        createdAt: Date.now(),
        isPermanent: true,
        userId: userEmail
    }));

    return jsonResponse({ success: true, savedEmails });
}

async function handleDelete(request, user, env, userEmail) {
    const { address } = await request.json();

    if (!address) {
        return jsonResponse({ error: 'Address required' }, 400);
    }

    const savedEmails = user.savedEmails || [];
    const index = savedEmails.findIndex(e => e.address === address);

    if (index === -1) {
        return jsonResponse({ error: 'Email not found' }, 404);
    }

    savedEmails.splice(index, 1);
    user.savedEmails = savedEmails;
    await env.USERS.put(userEmail, JSON.stringify(user));

    // Remove from TEMP_EMAILS
    await env.TEMP_EMAILS.delete(address);

    return jsonResponse({ success: true, savedEmails });
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
