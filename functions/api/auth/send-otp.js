/**
 * Send OTP — Email Verification or Password Reset
 * POST /api/auth/send-otp
 * Body: { type: 'email_verify'|'password_reset', username, email? }
 */

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        if (!env.RESEND_API_KEY) {
            return jsonResponse({ error: 'Email service not configured' }, 503);
        }

        const { type, username, email } = await request.json();

        if (!type || !['email_verify', 'password_reset'].includes(type)) {
            return jsonResponse({ error: 'Invalid OTP type' }, 400);
        }
        if (!username) {
            return jsonResponse({ error: 'Username is required' }, 400);
        }

        const userKey = `user:${username.toLowerCase()}`;
        let targetEmail;

        if (type === 'email_verify') {
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
        } else {
            // password_reset — look up stored email
            const user = await env.EMAILS.get(userKey, { type: 'json' });
            if (!user) {
                return jsonResponse({ error: 'Username not found' }, 404);
            }
            if (!user.email) {
                return jsonResponse({ error: 'No recovery email on file for this account' }, 400);
            }
            targetEmail = user.email.toLowerCase();
        }

        // Rate limit: max 3 OTPs per 10 minutes per email
        const rateLimitKey = `otp_rate:${targetEmail}`;
        const rateRaw = await env.EMAILS.get(rateLimitKey);
        const rateCount = rateRaw ? parseInt(rateRaw, 10) : 0;
        if (rateCount >= 3) {
            return jsonResponse({ error: 'Too many codes requested. Please wait 10 minutes.' }, 429);
        }
        await env.EMAILS.put(rateLimitKey, String(rateCount + 1), { expirationTtl: 600 });

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
        const subject = type === 'email_verify'
            ? 'Verify your Phantom Mail email address'
            : 'Reset your Phantom Mail password';
        const body = type === 'email_verify'
            ? `Your Phantom Mail verification code is: <strong>${code}</strong><br><br>This code expires in 10 minutes.`
            : `Your Phantom Mail password reset code is: <strong>${code}</strong><br><br>This code expires in 10 minutes.`;

        const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: 'noreply@mail.unknowns.app',
                to: [targetEmail],
                subject,
                html: `<p>${body}</p>`
            })
        });

        if (!emailRes.ok) {
            return jsonResponse({ error: 'Failed to send email. Please try again.' }, 500);
        }

        const maskedEmail = maskEmail(targetEmail);
        return jsonResponse({ success: true, otpToken, maskedEmail });

    } catch (error) {
        return jsonResponse({ error: 'Server error' }, 500);
    }
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

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}
