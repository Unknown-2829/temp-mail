/**
 * QR Code Generation API
 * Fetches a QR image from QRServer.com and returns it as a base64 data-URI.
 */

export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const email = url.searchParams.get('email');

    if (!email) {
        return jsonResponse({ error: 'Missing email parameter' }, 400);
    }

    try {
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(email)}&margin=10`;
        const qrResponse = await fetch(qrUrl);

        if (!qrResponse.ok) {
            throw new Error('QR Server failed');
        }

        const qrBuffer = await qrResponse.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(qrBuffer)));

        return jsonResponse(
            { qr: `data:image/png;base64,${base64}`, email },
            200,
            { 'Cache-Control': 'public, max-age=3600' }
        );
    } catch (error) {
        return jsonResponse({ error: 'QR generation failed: ' + error.message }, 500);
    }
}

function jsonResponse(data, status = 200, extra = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            ...extra
        }
    });
}
