/**
 * Send OTP to user's email via SendGrid
 * POST /api/auth/send-otp
 * Body: { email: string }
 */

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const { email } = await request.json();

        if (!email || !email.includes('@')) {
            return jsonResponse({ error: 'Invalid email' }, 400);
        }

        // Generate 6-digit OTP
        const otp = String(Math.floor(100000 + Math.random() * 900000));

        // Store OTP in KV with 10-minute expiry
        const otpKey = `otp:${email}`;
        await env.OTP_STORE.put(otpKey, otp, { expirationTtl: 600 });

        // Send email via SendGrid
        const sendgridResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${env.SENDGRID_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                personalizations: [{ to: [{ email }] }],
                from: { email: 'noreply@unknownlll2829.qzz.io', name: 'TempMail' },
                subject: 'Your TempMail Verification Code',
                content: [{
                    type: 'text/html',
                    value: `
            <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #00d09c;">TempMail Verification</h2>
              <p>Your verification code is:</p>
              <div style="background: #1a1a2e; color: #00d09c; font-size: 32px; font-weight: bold; padding: 20px; text-align: center; border-radius: 8px; letter-spacing: 8px;">
                ${otp}
              </div>
              <p style="color: #888; font-size: 12px; margin-top: 20px;">This code expires in 10 minutes. Do not share it with anyone.</p>
            </div>
          `
                }]
            })
        });

        if (!sendgridResponse.ok) {
            const errText = await sendgridResponse.text();
            console.error('SendGrid error:', errText);
            return jsonResponse({ error: 'Failed to send email' }, 500);
        }

        return jsonResponse({ success: true, message: 'OTP sent' });

    } catch (error) {
        console.error('Send OTP error:', error);
        return jsonResponse({ error: 'Server error' }, 500);
    }
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        }
    });
}
