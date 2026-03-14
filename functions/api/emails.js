export async function onRequestGet(context) {
    try {
        const { request, env } = context;
        const url = new URL(request.url);
        const address = url.searchParams.get('address');

        if (!address) {
            return jsonResponse({ error: 'Email address required' }, 400);
        }

        // Fetch all email keys for this address in parallel with their data
        const emailKeys = await env.EMAILS.list({ prefix: `email:${address}:` });

        const emails = (
            await Promise.all(
                emailKeys.keys.map(key => env.EMAILS.get(key.name, { type: 'json' }))
            )
        ).filter(Boolean);

        // Sort newest first
        emails.sort((a, b) => b.timestamp - a.timestamp);

        return jsonResponse({ emails });
    } catch (error) {
        return jsonResponse({ error: error.message }, 500);
    }
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store'
        }
    });
}
