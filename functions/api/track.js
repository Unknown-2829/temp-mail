/**
 * GET /api/track?id=TRACKING_ID&event=open
 * Records email open events and returns a 1x1 transparent PNG.
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const trackingId = url.searchParams.get('id');
  const event = url.searchParams.get('event') || 'open';

  // Always return the pixel immediately — never block on storage
  const pixel = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
  const pixelBytes = Uint8Array.from(pixel, c => c.charCodeAt(0));

  // Record open in background (don't await — return pixel instantly)
  if (trackingId && env.EMAILS) {
    context.waitUntil(recordOpen(trackingId, request, env));
  }

  return new Response(pixelBytes, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  });
}

async function recordOpen(trackingId, request, env) {
  try {
    const sentKey = await env.EMAILS.get(`track:${trackingId}`);
    if (!sentKey) return;

    const record = await env.EMAILS.get(sentKey, { type: 'json' });
    if (!record) return;

    const ip = request.headers.get('CF-Connecting-IP') ||
                request.headers.get('X-Forwarded-For') || 'unknown';
    const agent = request.headers.get('User-Agent') || 'unknown';
    const country = request.headers.get('CF-IPCountry') || 'unknown';

    record.opens = (record.opens || 0) + 1;
    record.lastOpenAt = Date.now();
    record.lastOpenIp = ip;
    record.lastOpenAgent = agent;
    record.lastOpenCountry = country;

    // Keep open history (last 20 opens)
    if (!record.openHistory) record.openHistory = [];
    record.openHistory.unshift({ at: Date.now(), ip, agent, country });
    if (record.openHistory.length > 20) record.openHistory = record.openHistory.slice(0, 20);

    await env.EMAILS.put(sentKey, JSON.stringify(record), {
      expirationTtl: 30 * 24 * 3600
    });
  } catch (err) {
    console.error('Track error:', err);
  }
}
