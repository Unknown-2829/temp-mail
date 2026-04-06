/**
 * Google OAuth - Firebase ID Token Auth
 * POST /api/auth/google
 * Body: { idToken, email, name, uid, photoURL }
 *
 * Token verification: Firebase identitytoolkit accounts:lookup
 * (reliable for Firebase-issued ID tokens; oauth2 tokeninfo is for OAuth access tokens)
 */

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const { idToken, email, name, uid, photoURL } = await request.json();

        if (!idToken || !email) {
            return jsonResponse({ error: 'Missing required fields' }, 400);
        }

        // Verify Firebase ID token via Firebase REST API — the correct approach for
        // Firebase-issued tokens (identitytoolkit returns the full user profile too)
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
            return jsonResponse({ error: 'Invalid or expired Google token' }, 401);
        }

        // Use verified data from Firebase — more trustworthy than what the client sent
        const fbUser = verifyData.users[0];
        if (fbUser.email !== email) {
            return jsonResponse({ error: 'Email mismatch' }, 401);
        }

        // Prefer verified Firebase fields; fall back to client-supplied values
        const verifiedName     = fbUser.displayName  || name  || email.split('@')[0];
        const verifiedPhotoURL = fbUser.photoUrl     || photoURL || null;
        const verifiedUid      = fbUser.localId      || uid;

        // Find or create user in KV (keyed by email)
        const userKey = `user:${email}`;
        let user = await env.EMAILS.get(userKey, { type: 'json' });
        let needsSave = false;

        if (!user) {
            // Brand-new Google user — create account
            user = {
                username: userKey,
                displayUsername: verifiedName,
                email,
                googleUid: verifiedUid,
                authProviders: ['google'],
                isPremium: false,
                premiumExpiry: null,
                savedEmails: [],
                apiKey: null,
                photoURL: verifiedPhotoURL,
                createdAt: Date.now()
            };
            needsSave = true;
        } else {
            // Existing user — link Google if not already linked
            if (!user.googleUid) {
                user.googleUid = verifiedUid;
                const providers = Array.isArray(user.authProviders) ? user.authProviders : [];
                if (!providers.includes('google')) providers.push('google');
                user.authProviders = providers;
                needsSave = true;
            }

            // Update display name if the user never set one
            if (!user.displayUsername && verifiedName) {
                user.displayUsername = verifiedName;
                needsSave = true;
            }

            // Update photoURL from Google on every login UNLESS the user has
            // uploaded a custom avatar (stored under /api/avatar?key=avatars/...)
            const hasCustomAvatar = user.photoURL && user.photoURL.startsWith('/api/avatar');
            if (!hasCustomAvatar && verifiedPhotoURL && user.photoURL !== verifiedPhotoURL) {
                user.photoURL = verifiedPhotoURL;
                needsSave = true;
            }
        }

        // Expire premium if needed
        let isPremium = user.isPremium;
        if (isPremium && user.premiumExpiry && user.premiumExpiry < Date.now()) {
            user.isPremium = false;
            user.premiumExpiry = null;
            isPremium = false;
            needsSave = true;
        }

        if (needsSave) {
            await env.EMAILS.put(userKey, JSON.stringify(user));
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
            isPremium: isPremium || false,
            photoURL: user.photoURL || null
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

