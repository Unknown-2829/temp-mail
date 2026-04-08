/**
 * GET /api/sent?address=EMAIL
 * Returns sent emails and their open analytics.
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const address = url.searchParams.get('address');

  if (!address) return jsonResponse({ error: 'address required' }, 400);

  try {
    const keys = await env.EMAILS.list({ prefix: `sent:${address}:`, limit: 50 });
    const sent = (await Promise.all(
      keys.keys.map(k => env.EMAILS.get(k.name, { type: 'json' }))
    )).filter(Boolean);

    sent.sort((a, b) => b.sentAt - a.sentAt);
    return jsonResponse({ sent });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
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
