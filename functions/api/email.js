export async function onRequestGet(context) {
    try {
        const { request, env } = context;
        const url = new URL(request.url);
        const key = url.searchParams.get('key');
        const address = url.searchParams.get('address');

        if (!key || !address) {
            return jsonResponse({ error: 'key and address required' }, 400);
        }

        // Security: key must belong to the address being queried
        if (!key.startsWith(`email:${address}:`)) {
            return jsonResponse({ error: 'Forbidden' }, 403);
        }

        const data = await env.EMAILS.get(key, { type: 'json' });
        if (!data) {
            return jsonResponse({ error: 'Not found' }, 404);
        }

        return jsonResponse({ email: { ...data, _key: key } });
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
