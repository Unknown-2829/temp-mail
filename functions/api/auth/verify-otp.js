/**
 * Verify OTP and create session
 * POST /api/auth/verify-otp
 * Body: { email: string, otp: string }
 */

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const { email, otp } = await request.json();

        if (!email || !otp) {
            return jsonResponse({ error: 'Email and OTP required' }, 400);
        }

        // Get stored OTP
        const otpKey = `otp:${email}`;
        const storedOtp = await env.OTP_STORE.get(otpKey);

        if (!storedOtp) {
            return jsonResponse({ error: 'OTP expired or not found' }, 400);
        }

        if (storedOtp !== otp) {
            return jsonResponse({ error: 'Invalid OTP' }, 400);
        }

        // Delete used OTP
        await env.OTP_STORE.delete(otpKey);

        // Get or create user
        let user = await env.USERS.get(email, { type: 'json' });

        if (!user) {
            user = {
                email,
                createdAt: Date.now(),
                isPremium: false,
                premiumExpiry: null,
                savedEmails: [],
                apiKey: null
            };
            await env.USERS.put(email, JSON.stringify(user));
        }

        // Generate session token
        const token = generateToken();
        const sessionData = {
            email,
            createdAt: Date.now(),
            expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
        };

        await env.SESSIONS.put(token, JSON.stringify(sessionData), {
            expirationTtl: 7 * 24 * 60 * 60 // 7 days in seconds
        });

        return jsonResponse({
            success: true,
            token,
            isPremium: user.isPremium,
            email: user.email
        });

    } catch (error) {
        console.error('Verify OTP error:', error);
        return jsonResponse({ error: 'Server error' }, 500);
    }
}

function generateToken() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 64; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
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
