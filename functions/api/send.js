/**
 * CLOUDFLARE SETUP REQUIRED:
 *
 * 1. Sign up at resend.com
 * 2. Add domain: unknownlll2829.qzz.io
 * 3. Add DNS records Resend gives you in Cloudflare DNS
 * 4. Get API key from Resend dashboard
 * 5. In Cloudflare Pages → Settings → Environment Variables:
 *    Add secret: RESEND_API_KEY = re_xxxxxxxxxx
 * 6. Redeploy Pages project
 */

/**
 * POST /api/send
 * Sends an email via Resend API.
 *
 * Required env: RESEND_API_KEY (Cloudflare secret)
 * Required bindings: EMAILS (KV), TEMP_EMAILS (KV)
 *
 * Rate limits (stored in KV):
 *   Free/anonymous: 3 sends per day
 *   Premium: 50 sends per day
 *
 * Body (JSON):
 *   from      - string, must end with @unknownlll2829.qzz.io
 *   to        - string or string[], recipient(s)
 *   subject   - string
 *   body      - string (plain text or HTML)
 *   isHtml    - boolean
 *   replyTo   - string (optional)
 */
export async function onRequestPost(context) {
  const { request, env } = context;

  // ── Auth (optional but tracked) ──────────────────────────────
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  let username = null;
  let isPremium = false;

  if (token) {
    try {
      const userData = await env.EMAILS.get(`auth:token:${token}`, { type: 'json' });
      if (userData) {
        username = userData.username;
        isPremium = !!userData.isPremium;
      }
    } catch (_) {}
  }

  // ── Parse body ───────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { from, to, subject, body: emailBody, isHtml, replyTo } = body;

  // ── Validate ─────────────────────────────────────────────────
  if (!from || !to || !subject || !emailBody) {
    return jsonResponse({ error: 'from, to, subject, body are required' }, 400);
  }

  // Only allow sending FROM our domain — prevents spoofing
  if (!from.endsWith('@unknownlll2829.qzz.io')) {
    return jsonResponse({ error: 'You can only send from @unknownlll2829.qzz.io addresses' }, 403);
  }

  // Validate recipient
  const recipients = Array.isArray(to) ? to : [to];
  if (recipients.length === 0 || recipients.length > 5) {
    return jsonResponse({ error: 'Between 1 and 5 recipients allowed' }, 400);
  }
  for (const r of recipients) {
    if (!r.includes('@') || r.length > 254) {
      return jsonResponse({ error: `Invalid recipient: ${r}` }, 400);
    }
  }

  // Subject length
  if (subject.length > 998) {
    return jsonResponse({ error: 'Subject too long' }, 400);
  }

  // Body length — 500KB max
  if (emailBody.length > 500000) {
    return jsonResponse({ error: 'Email body too large' }, 400);
  }

  // ── Rate limiting ─────────────────────────────────────────────
  const rateLimitKey = username
    ? `send_rate:user:${username}`
    : `send_rate:addr:${from}`;
  const dailyLimit = isPremium ? 50 : 3;

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  let rateData = await env.EMAILS.get(rateLimitKey, { type: 'json' }) || { date: today, count: 0 };

  if (rateData.date !== today) {
    rateData = { date: today, count: 0 };
  }

  if (rateData.count >= dailyLimit) {
    return jsonResponse({
      error: `Daily send limit reached (${dailyLimit}/day). ${isPremium ? '' : 'Upgrade to Premium for 50/day.'}`
    }, 429);
  }

  // ── Build Phantom Mail signature footer ───────────────────────
  const phantomFooterHtml = `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;
     font-family:Arial,sans-serif;font-size:12px;color:#888;text-align:center;">
  Sent via <a href="https://mail.unknowns.app" style="color:#00d09c;text-decoration:none;">
  Phantom Mail</a> &nbsp;·&nbsp;
  Developer: <a href="https://t.me/unknownlll2829" style="color:#00d09c;text-decoration:none;">
  @Unknown</a>
</div>`;

  const phantomFooterText = `\n\n---\nSent via Phantom Mail (https://mail.unknowns.app)\nDeveloper: @Unknown (https://t.me/unknownlll2829)`;

  // ── Generate tracking pixel ───────────────────────────────────
  const trackingId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const trackingPixel = `<img width="1" height="1" src="https://mail.unknowns.app/api/track?id=${trackingId}&event=open" style="display:none;" />`;

  // ── Compose final email ───────────────────────────────────────
  let finalHtml = null;
  let finalText = null;

  if (isHtml) {
    finalHtml = emailBody + phantomFooterHtml + trackingPixel;
  } else {
    // Convert plain text to basic HTML for tracking pixel support
    const escaped = emailBody
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    finalHtml = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;">${escaped}</div>${phantomFooterHtml}${trackingPixel}`;
    finalText = emailBody + phantomFooterText;
  }

  // ── Call Resend API ───────────────────────────────────────────
  if (!env.RESEND_API_KEY) {
    return jsonResponse({ error: 'Email sending not configured' }, 503);
  }

  const resendPayload = {
    from: `Phantom Mail <${from}>`,
    to: recipients,
    subject,
    html: finalHtml,
    ...(finalText && { text: finalText }),
    ...(replyTo && { reply_to: replyTo }),
    headers: {
      'X-Mailer': 'Phantom Mail (https://mail.unknowns.app)',
      'X-Tracking-ID': trackingId
    }
  };

  let resendResult;
  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(resendPayload)
    });
    resendResult = await resendRes.json();

    if (!resendRes.ok) {
      console.error('Resend error:', resendResult);
      return jsonResponse({ error: resendResult.message || 'Failed to send email' }, 502);
    }
  } catch (err) {
    return jsonResponse({ error: 'Network error sending email' }, 502);
  }

  // ── Store sent email record + tracking init ───────────────────
  const sentKey = `sent:${from}:${Date.now()}`;
  const sentRecord = {
    id: resendResult.id,
    trackingId,
    from,
    to: recipients,
    subject,
    body: emailBody.slice(0, 10000), // store up to 10 KB for preview/display
    isHtml,
    sentAt: Date.now(),
    opens: 0,
    lastOpenAt: null,
    lastOpenIp: null,
    lastOpenAgent: null
  };
  await env.EMAILS.put(sentKey, JSON.stringify(sentRecord), {
    expirationTtl: 15 * 24 * 3600 // keep for 15 days
  });

  // Store trackingId → sentKey mapping for open tracking lookup
  await env.EMAILS.put(`track:${trackingId}`, sentKey, {
    expirationTtl: 15 * 24 * 3600
  });

  // ── Update rate limit ─────────────────────────────────────────
  rateData.count += 1;
  await env.EMAILS.put(rateLimitKey, JSON.stringify(rateData), {
    expirationTtl: 2 * 24 * 3600
  });

  return jsonResponse({
    success: true,
    id: resendResult.id,
    trackingId,
    remaining: dailyLimit - rateData.count
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

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}
