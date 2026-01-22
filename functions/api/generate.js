export async function onRequestPost(context) {
    try {
        const { env } = context;

        // Generate random email
        const randomId = generateRandomString(10);
        const email = `${randomId}@unknownlll2829.qzz.io`;

        // Store in KV
        const emailData = {
            createdAt: Date.now(),
            expiresAt: Date.now() + 3600000,
        };

        await env.TEMP_EMAILS.put(
            email,
            JSON.stringify(emailData),
            { expirationTtl: 3600 }
        );

        return new Response(
            JSON.stringify({ email }),
            { headers: { 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}

function generateRandomString(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}
