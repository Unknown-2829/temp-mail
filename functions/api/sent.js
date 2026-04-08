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
      keys.keys.map(async k => {
        const record = await env.EMAILS.get(k.name, { type: 'json' });
        if (!record) return null;
        return { ...record, _kvKey: k.name };
      })
    )).filter(Boolean);

    sent.sort((a, b) => b.sentAt - a.sentAt);
    return jsonResponse({ sent });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

/**
 * DELETE /api/sent?address=EMAIL&key=KV_KEY
 * Deletes a specific sent email record from KV.
 */
export async function onRequestDelete(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const address = url.searchParams.get('address');
  const key = url.searchParams.get('key');

  if (!address || !key) return jsonResponse({ error: 'address and key required' }, 400);

  // Security: key must belong to the requested address
  if (!key.startsWith(`sent:${address}:`)) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  try {
    await env.EMAILS.delete(key);
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
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
