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

        // Verify Firebase ID token using Firebase REST API
        // This is the correct endpoint for Firebase ID tokens (not oauth2 tokeninfo)
        const projectId = env.FIREBASE_PROJECT_ID;
        const verifyRes = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idToken })
            }
        );

        const verifyData = await verifyRes.json();

        if (verifyData.error || !verifyData.users || verifyData.users.length === 0) {
            return jsonResponse({ error: 'Invalid or expired token' }, 401);
        }

        const firebaseUser = verifyData.users[0];

        // Make sure email matches
        if (firebaseUser.email !== email) {
            return jsonResponse({ error: 'Email mismatch' }, 401);
        }

        // Find or create user in KV
        const userKey = `user:${email}`;
        let user = await env.EMAILS.get(userKey, { type: 'json' });

        if (!user) {
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
            // Link Google to existing email/password account
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

        // Create session token
        const token = generateToken();
        await env.EMAILS.put(`session:${token}`, JSON.stringify({
            username: userKey,
            createdAt: Date.now(),
            expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000)
        }), { expirationTtl: 7 * 24 * 60 * 60 });

        return jsonResponse({
            success: true,
            token,
            username: user.displayUsername || email.split('@')[0],
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
