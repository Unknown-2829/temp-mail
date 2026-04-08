/**
 * GET /api/sent
 *  - With Authorization Bearer token: returns ALL sent emails for that user (across all from-addresses)
 *  - With ?address=EMAIL: returns sent emails for that specific address (anonymous fallback)
 *
 * DELETE /api/sent?key=KV_KEY[&address=EMAIL]
 *  - Deletes the sent email KV record; cleans up sentidx entry if authenticated
 */
export async function onRequestGet(context) {
  const { request, env } = context;

  // Try token-based user lookup first
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (token) {
    try {
      const session = await env.EMAILS.get(`session:${token}`, { type: 'json' });
      if (session && session.expiresAt > Date.now()) {
        const username = session.username;
        // List all sentidx entries for this user
        const idxKeys = await env.EMAILS.list({ prefix: `sentidx:user:${username}:`, limit: 100 });
        const sent = (await Promise.all(
          idxKeys.keys.map(async k => {
            const sentKey = await env.EMAILS.get(k.name, { type: 'text' });
            if (!sentKey) return null;
            const record = await env.EMAILS.get(sentKey, { type: 'json' });
            if (!record) return null;
            return { ...record, _kvKey: sentKey, _idxKey: k.name };
          })
        )).filter(Boolean);
        sent.sort((a, b) => b.sentAt - a.sentAt);
        return jsonResponse({ sent });
      }
    } catch (_) {}
  }

  // Fallback: address-based lookup (anonymous / session expired)
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

export async function onRequestDelete(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  const address = url.searchParams.get('address');
  const idxKey = url.searchParams.get('idxKey');

  if (!key) return jsonResponse({ error: 'key required' }, 400);

  // Security: key must start with sent: prefix
  if (!key.startsWith('sent:')) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }
  // If address provided, key must belong to it
  if (address && !key.startsWith(`sent:${address}:`)) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  try {
    await env.EMAILS.delete(key);

    // Clean up sentidx entry if provided and authenticated
    if (idxKey && idxKey.startsWith('sentidx:user:')) {
      // Verify ownership via token before deleting index
      const authHeader = request.headers.get('Authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (token) {
        try {
          const session = await env.EMAILS.get(`session:${token}`, { type: 'json' });
          if (session && session.expiresAt > Date.now()) {
            const expectedPrefix = `sentidx:user:${session.username}:`;
            if (idxKey.startsWith(expectedPrefix)) {
              await env.EMAILS.delete(idxKey);
            }
          }
        } catch (_) {}
      }
    }

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
