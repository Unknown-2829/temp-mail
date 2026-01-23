/**
 * Developer API - Get Emails
 * GET /api/v1/emails?address=xxx@domain.com
 * Header: X-API-Key: YOUR_API_KEY
 */

export async function onRequestGet(context) {
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

    try {
        const url = new URL(request.url);
        const address = url.searchParams.get('address');

        if (!address) {
            return jsonResponse({ error: 'Address parameter required' }, 400);
        }

        // Verify email exists
        const emailExists = await env.TEMP_EMAILS.get(address);
        if (!emailExists) {
            return jsonResponse({ error: 'Email not found or expired' }, 404);
        }

        // Get all emails for this address
        const emails = [];
        const prefix = `email:${address}:`;
        const list = await env.EMAILS.list({ prefix });

        for (const key of list.keys) {
            const emailData = await env.EMAILS.get(key.name, { type: 'json' });
            if (emailData) {
                // Remove large data for API response
                const { htmlBody, ...emailSummary } = emailData;
                emailSummary.hasHtml = !!htmlBody;
                emails.push(emailSummary);
            }
        }

        // Sort by timestamp descending
        emails.sort((a, b) => b.timestamp - a.timestamp);

        return jsonResponse({
            success: true,
            address,
            count: emails.length,
            emails
        });

    } catch (error) {
        console.error('API emails error:', error);
        return jsonResponse({ error: 'Server error' }, 500);
    }
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
