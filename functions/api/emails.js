export async function onRequestGet(context) {
    try {
        const { request, env } = context;
        const url = new URL(request.url);
        const address = url.searchParams.get('address');

        if (!address) {
            return new Response(
                JSON.stringify({ error: 'Email address required' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Get all emails for this address
        const emailKeys = await env.EMAILS.list({ prefix: `email:${address}:` });

        const emails = [];
        for (const key of emailKeys.keys) {
            const emailData = await env.EMAILS.get(key.name);
            if (emailData) {
                emails.push(JSON.parse(emailData));
            }
        }

        // Sort by timestamp
        emails.sort((a, b) => b.timestamp - a.timestamp);

        return new Response(
            JSON.stringify({ emails }),
            { headers: { 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}
