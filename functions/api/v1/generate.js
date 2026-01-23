/**
 * Developer API - Generate Temp Email
 * POST /api/v1/generate
 * Header: X-API-Key: YOUR_API_KEY
 * Optional Body: { username: string } for custom username (premium)
 */

export async function onRequestPost(context) {
    const { request, env } = context;

    // Get API key from header
    const apiKey = request.headers.get('X-API-Key');
    if (!apiKey) {
        return jsonResponse({ error: 'API key required' }, 401);
    }

    // Validate API key
    const keyData = await env.API_KEYS.get(apiKey, { type: 'json' });
    if (!keyData) {
        return jsonResponse({ error: 'Invalid API key' }, 401);
    }

    // Check rate limit (100/day free)
    const today = new Date().toISOString().split('T')[0];
    const usageKey = `usage:${apiKey}:${today}`;
    let usage = parseInt(await env.API_USAGE.get(usageKey) || '0');

    const limit = keyData.isPremium ? 10000 : 100;
    if (usage >= limit) {
        return jsonResponse({ error: 'Rate limit exceeded', limit, used: usage }, 429);
    }

    try {
        let email;
        const body = await request.json().catch(() => ({}));

        // Custom username (premium only)
        if (body.username) {
            if (!keyData.isPremium) {
                return jsonResponse({ error: 'Custom usernames require premium' }, 403);
            }

            const username = body.username.toLowerCase().replace(/[^a-z0-9._-]/g, '');
            if (username.length < 3 || username.length > 30) {
                return jsonResponse({ error: 'Username must be 3-30 characters' }, 400);
            }

            email = `${username}@unknownlll2829.qzz.io`;

            // Check if exists
            const exists = await env.TEMP_EMAILS.get(email);
            if (exists) {
                return jsonResponse({ error: 'Username already taken' }, 400);
            }
        } else {
            // Generate random email
            email = generateRandomEmail();

            // Ensure unique
            let attempts = 0;
            while (await env.TEMP_EMAILS.get(email) && attempts < 5) {
                email = generateRandomEmail();
                attempts++;
            }
        }

        // Store email
        await env.TEMP_EMAILS.put(email, JSON.stringify({
            createdAt: Date.now(),
            apiGenerated: true,
            apiKey: apiKey.substring(0, 8) + '...'
        }), { expirationTtl: 3600 });

        // Increment usage
        await env.API_USAGE.put(usageKey, String(usage + 1), { expirationTtl: 86400 });

        return jsonResponse({
            success: true,
            email,
            expiresIn: 3600,
            usage: {
                today: usage + 1,
                limit
            }
        });

    } catch (error) {
        console.error('API generate error:', error);
        return jsonResponse({ error: 'Server error' }, 500);
    }
}

function generateRandomEmail() {
    const adjectives = ['cool', 'fast', 'smart', 'happy', 'lucky', 'bright', 'swift'];
    const nouns = ['user', 'mail', 'box', 'temp', 'quick', 'test', 'demo'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 9999);
    return `${adj}${noun}${num}@unknownlll2829.qzz.io`;
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
