/**
 * Google OAuth - Firebase ID Token Auth
 * POST /api/auth/google
 * Body: { idToken, email, name, uid, photoURL }
 */

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const { idToken, email, name, uid, photoURL } = await request.json();

        if (!idToken || !email) {
            return jsonResponse({ error: 'Missing required fields' }, 400);
        }

        // Verify Firebase ID token using Google's public tokeninfo endpoint
        const verifyRes = await fetch(
            `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
        );
        const payload = await verifyRes.json();

        if (payload.error || payload.email !== email) {
            return jsonResponse({ error: 'Invalid or expired token' }, 401);
        }

        // Check that the token was issued for our Firebase project
        const senderId = env.FIREBASE_MESSAGING_SENDER_ID;
        const projectId = env.FIREBASE_PROJECT_ID;
        const audOk = senderId && projectId && (
            payload.aud === senderId ||
            payload.aud?.includes(senderId) ||
            payload.aud === projectId ||
            payload.aud?.includes(projectId)
        );
        if (!audOk) {
            return jsonResponse({ error: 'Token audience mismatch' }, 401);
        }

        // Find or create user in KV (keyed by email, same store as username-based users)
        const userKey = `user:${email}`;
        let user = await env.EMAILS.get(userKey, { type: 'json' });

        if (!user) {
            // New Google user — create account (no password needed)
            user = {
                username: userKey,
                displayUsername: name || email.split('@')[0],
                email,
                googleUid: uid,
                authProviders: ['google'],
                isPremium: false,
                premiumExpiry: null,
                savedEmails: [],
                apiKey: null,
                photoURL: photoURL || null,
                createdAt: Date.now()
            };
            await env.EMAILS.put(userKey, JSON.stringify(user));
        } else if (!user.googleUid) {
            // Existing email/password user — link Google to their account
            user.googleUid = uid;
            const providers = Array.isArray(user.authProviders) ? user.authProviders : [];
            if (!providers.includes('google')) providers.push('google');
            user.authProviders = providers;
            if (photoURL && !user.photoURL) user.photoURL = photoURL;
            if (!user.displayUsername && name) user.displayUsername = name;
            await env.EMAILS.put(userKey, JSON.stringify(user));
        }

        // Check premium expiry
        let isPremium = user.isPremium;
        if (isPremium && user.premiumExpiry && user.premiumExpiry < Date.now()) {
            user.isPremium = false;
            user.premiumExpiry = null;
            await env.EMAILS.put(userKey, JSON.stringify(user));
            isPremium = false;
        }

        // Create session token — same format as signin.js so profile.js works unchanged
        const token = generateToken();
        const sessionData = {
            username: userKey,
            createdAt: Date.now(),
            expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000)
        };
        await env.EMAILS.put(`session:${token}`, JSON.stringify(sessionData), {
            expirationTtl: 7 * 24 * 60 * 60
        });

        const displayName = user.displayUsername || email.split('@')[0];
        return jsonResponse({
            success: true,
            token,
            username: displayName,
            isPremium: isPremium || false
        });

    } catch (err) {
        console.error('Google auth error:', err);
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
}

function generateToken() {
    return Array.from(crypto.getRandomValues(new Uint8Array(48)))
        .map(b => b.toString(16).padStart(2, '0')).join('');
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}
