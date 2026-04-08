/**
 * Send OTP — Email Verification, Password Reset, or Add Recovery Email
 * POST /api/auth/send-otp
 * Body: { type: 'email_verify'|'password_reset'|'add_email', username?, email? }
 * For 'add_email': requires Bearer token instead of username
 */

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        if (!env.RESEND_API_KEY) {
            return jsonResponse({ error: 'Email service not configured' }, 503);
        }

        const { type, username, email } = await request.json();

        if (!type || !['email_verify', 'password_reset', 'add_email'].includes(type)) {
            return jsonResponse({ error: 'Invalid OTP type' }, 400);
        }

        let targetEmail;
        let userKey;

        if (type === 'email_verify') {
            if (!username) return jsonResponse({ error: 'Username is required' }, 400);
            // Normalise: trim, lowercase, spaces → underscores (mirrors signup logic)
            const normalised = username.trim().toLowerCase().replace(/\s+/g, '_');
            userKey = `user:${normalised}`;
            // Validate username availability
            const existing = await env.EMAILS.get(userKey);
            if (existing) {
                return jsonResponse({ error: 'Username already taken' }, 400);
            }
            // Validate email format
            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return jsonResponse({ error: 'Invalid email address' }, 400);
            }
            targetEmail = email.toLowerCase();
            if (isReservedEmail(targetEmail)) {
                return jsonResponse({ error: 'This email address cannot be used as a recovery email.' }, 400);
            }

        } else if (type === 'password_reset') {
            if (!username) return jsonResponse({ error: 'Username is required' }, 400);
            // Normalise the same way signin does
            let normalised = username.trim().toLowerCase();
            if (!normalised.includes('@')) normalised = normalised.replace(/\s+/g, '_');
            userKey = `user:${normalised}`;
            // Look up user
            let user = await env.EMAILS.get(userKey, { type: 'json' });
            // Try username alias (for Google users who set a password and registered a display-name alias)
            if (!user) {
                const aliasKey = `user_ptr:${normalised}`;
                const aliasTarget = await env.EMAILS.get(aliasKey);
                if (aliasTarget) {
                    userKey = aliasTarget;
                    const aliasedUser = await env.EMAILS.get(aliasTarget, { type: 'json' });
                    if (aliasedUser) {
                        user = aliasedUser;
                    }
                }
            }
            if (!user) {
                return jsonResponse({ error: 'Username not found' }, 404);
            }
            if (!user.email && Array.isArray(user.authProviders) && user.authProviders.includes('google')) {
                // Google user — use their Google email (extracted from userKey: user:email@gmail.com)
                const googleEmail = userKey.replace(/^user:/, '');
                if (googleEmail.includes('@')) {
                    targetEmail = googleEmail.toLowerCase();
                } else {
                    return jsonResponse({ error: 'No recovery email on file for this account' }, 400);
                }
            } else if (!user.email) {
                return jsonResponse({ error: 'No recovery email on file for this account' }, 400);
            } else {
                targetEmail = user.email.toLowerCase();
            }

        } else {
            // add_email — requires auth token from a logged-in user
            const token = request.headers.get('Authorization')?.replace('Bearer ', '');
            if (!token) return jsonResponse({ error: 'Unauthorized' }, 401);
            const session = await env.EMAILS.get(`session:${token}`, { type: 'json' });
            if (!session || session.expiresAt < Date.now()) return jsonResponse({ error: 'Session expired' }, 401);
            userKey = session.username;
            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return jsonResponse({ error: 'Invalid email address' }, 400);
            }
            targetEmail = email.toLowerCase();
            if (isReservedEmail(targetEmail)) {
                return jsonResponse({ error: 'This email address cannot be used as a recovery email.' }, 400);
            }
        }

        // Rate limit: max 3 OTPs per 10 minutes per email
        const rateLimitKey = `otp_rate:${targetEmail}`;
        const rateRaw = await env.EMAILS.get(rateLimitKey);
        const rateCount = rateRaw ? parseInt(rateRaw, 10) : 0;
        if (rateCount >= 3) {
            return jsonResponse({ error: 'Too many codes requested. Please wait 10 minutes.' }, 429);
        }

        // Generate 6-digit OTP using rejection sampling to avoid modulo bias
        const code = generateOtpCode();
        const otpToken = generateToken();

        // Store OTP in KV
        const otpData = {
            type,
            userKey,
            email: targetEmail,
            code,
            expiresAt: Date.now() + 600000,
            attempts: 0
        };
        await env.EMAILS.put(`otp:${otpToken}`, JSON.stringify(otpData), { expirationTtl: 600 });

        // Send email via Resend API
        const subject =
            type === 'email_verify'   ? '👻 Verify your Phantom Mail account' :
            type === 'add_email'      ? '👻 Confirm your recovery email — Phantom Mail' :
                                        '🔑 Reset your Phantom Mail password';

        const html = buildOtpEmail(type, code);

        const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: 'Phantom Mail <noreply@unknownlll2829.qzz.io>',
                to: [targetEmail],
                subject,
                html
            })
        });

        if (!emailRes.ok) {
            return jsonResponse({ error: 'Failed to send email. Please try again.' }, 500);
        }

        // Increment rate limit only after successful send
        await env.EMAILS.put(rateLimitKey, String(rateCount + 1), { expirationTtl: 600 });

        const maskedEmail = maskEmail(targetEmail);
        return jsonResponse({ success: true, otpToken, maskedEmail });

    } catch (error) {
        return jsonResponse({ error: 'Server error' }, 500);
    }
}

const RESERVED_EMAILS = ['noreply@unknownlll2829.qzz.io', 'phantom-mail@unknownlll2829.qzz.io'];
const APP_DOMAIN = 'unknownlll2829.qzz.io';

function isReservedEmail(email) {
    const lower = email.toLowerCase();
    return RESERVED_EMAILS.includes(lower) || lower.endsWith('@' + APP_DOMAIN);
}

function generateOtpCode() {
    // Use rejection sampling to avoid modulo bias
    const range = 900000; // 100000–999999
    const maxUnbiased = Math.floor(0x100000000 / range) * range;
    let val;
    do {
        val = crypto.getRandomValues(new Uint32Array(1))[0];
    } while (val >= maxUnbiased);
    return String(100000 + (val % range));
}

function maskEmail(email) {
    const [local, domain] = email.split('@');
    if (local.length <= 2) return `${local[0]}*@${domain}`;
    return `${local[0]}${'*'.repeat(Math.min(local.length - 2, 4))}${local[local.length - 1]}@${domain}`;
}

function generateToken() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, '0')).join('');
}

function buildOtpEmail(type, code) {
    const headings = {
        email_verify: 'Verify your account',
        add_email:    'Confirm your recovery email',
        password_reset: 'Reset your password'
    };
    const subtexts = {
        email_verify: "You're one step away from securing your Phantom Mail account. Use the code below to verify your email address.",
        add_email:    "You requested to add a recovery email to your Phantom Mail account. Use the code below to confirm.",
        password_reset: "Someone requested a password reset for your Phantom Mail account. Use the code below to set a new password."
    };
    const heading = headings[type] || 'Verification Code';
    const subtext = subtexts[type] || 'Your one-time code is below.';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Phantom Mail — ${heading}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a14;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a14;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#13131f;border-radius:20px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#0d0d1e 0%,#1a1a30 100%);padding:32px 36px 24px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
              <div style="font-size:36px;margin-bottom:8px;">👻</div>
              <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">Phantom Mail</div>
              <div style="font-size:12px;color:#484868;margin-top:4px;letter-spacing:0.06em;text-transform:uppercase;">Private • Anonymous • Free</div>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 36px 28px;">
              <h2 style="margin:0 0 12px;font-size:18px;font-weight:700;color:#e8e8f8;">${heading}</h2>
              <p style="margin:0 0 28px;font-size:14px;line-height:1.7;color:#7878a0;">${subtext}</p>
              <!-- OTP Box -->
              <div style="background:#0c0c1c;border:1px solid rgba(0,208,156,0.25);border-radius:14px;padding:28px 20px;text-align:center;margin-bottom:28px;">
                <div style="font-size:11px;font-weight:700;color:#00d09c;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:14px;">Your one-time code</div>
                <div style="font-size:44px;font-weight:900;letter-spacing:0.22em;color:#ffffff;font-family:'JetBrains Mono','Courier New',monospace;text-shadow:0 0 24px rgba(0,208,156,0.35);">${code}</div>
                <div style="font-size:12px;color:#484868;margin-top:14px;">⏱ Expires in <strong style="color:#7878a0;">10 minutes</strong></div>
              </div>
              <p style="margin:0;font-size:12.5px;color:#484868;line-height:1.6;">If you didn't request this, you can safely ignore this email. Your account remains secure.</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#0c0c1c;padding:18px 36px;border-top:1px solid rgba(255,255,255,0.05);text-align:center;">
              <p style="margin:0;font-size:11.5px;color:#333348;">© 2026 Phantom Mail &nbsp;·&nbsp; <a href="https://mail.unknowns.app" style="color:#00d09c;text-decoration:none;">mail.unknowns.app</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}
