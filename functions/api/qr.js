/**
 * QR Code Generation API
 * Uses QRServer.com API - industry standard, fast, reliable
 * Returns redirect to QR image or base64 data
 */

export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const email = url.searchParams.get('email');
    const format = url.searchParams.get('format') || 'redirect'; // 'redirect' or 'base64'

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

        if (format === 'redirect') {
            // Direct redirect to QR image
            return Response.redirect(qrUrl, 302);
        }

        // Fetch and return as base64
        const qrResponse = await fetch(qrUrl);
        const qrBuffer = await qrResponse.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(qrBuffer)));

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
