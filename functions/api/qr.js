/**
 * QR Code Generation API
 * Uses QRServer.com API - industry standard, fast, reliable
 * Returns base64 encoded QR image
 */

export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const email = url.searchParams.get('email');

    if (!email) {
        return new Response(
            JSON.stringify({ error: 'Missing email parameter' }),
            {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }

    try {
        // QR Server API - free, fast, reliable
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(email)}&margin=10`;

        // Fetch QR image and convert to base64
        const qrResponse = await fetch(qrUrl);

        if (!qrResponse.ok) {
            throw new Error('QR Server failed');
        }

        const qrBuffer = await qrResponse.arrayBuffer();
        const bytes = new Uint8Array(qrBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);

        return new Response(
            JSON.stringify({
                qr: `data:image/png;base64,${base64}`,
                email: email
            }),
            {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=3600'
                }
            }
        );
    } catch (error) {
        return new Response(
            JSON.stringify({ error: 'QR generation failed: ' + error.message }),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
}
