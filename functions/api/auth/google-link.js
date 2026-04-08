/**
 * Link Google Account to existing Phantom Mail account
 * POST /api/auth/google-link
 * Headers: Authorization: Bearer <token>
 * Body: { idToken, email, name, uid, photoURL }
 */

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const token = request.headers.get('Authorization')?.replace('Bearer ', '');
        if (!token) return jsonResponse({ error: 'Unauthorized' }, 401);

        const session = await env.EMAILS.get(`session:${token}`, { type: 'json' });
        if (!session || session.expiresAt < Date.now()) {
            return jsonResponse({ error: 'Session expired' }, 401);
        }

        const { idToken, email, name, uid, photoURL } = await request.json();
        if (!idToken || !email) {
            return jsonResponse({ error: 'Missing required fields' }, 400);
        }

        // Verify Firebase ID token
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

        const fbUser = verifyData.users[0];
        if (fbUser.email !== email) {
            return jsonResponse({ error: 'Email mismatch' }, 401);
        }

        const verifiedName     = fbUser.displayName  || name  || email.split('@')[0];
        const verifiedPhotoURL = fbUser.photoUrl     || photoURL || null;
        const verifiedUid      = fbUser.localId      || uid;

        // Reject if this Google email already has its own Phantom Mail account
        const googleUserKey = `user:${email}`;
        const existingGoogleAccount = await env.EMAILS.get(googleUserKey);
        if (existingGoogleAccount) {
            return jsonResponse({
                error: 'This Google account is already linked to another Phantom Mail account.'
            }, 409);
        }

        // Get the current user
        const user = await env.EMAILS.get(session.username, { type: 'json' });
        if (!user) return jsonResponse({ error: 'User not found' }, 404);

        // Reject if already has a Google account linked
        if (user.googleUid) {
            return jsonResponse({ error: 'Your account already has a Google account linked.' }, 409);
        }

        // Link Google
        user.googleUid = verifiedUid;
        if (!Array.isArray(user.authProviders)) user.authProviders = [];
        if (!user.authProviders.includes('google')) user.authProviders.push('google');

        // Update photo if no custom avatar
        const hasCustomAvatar = user.photoURL && user.photoURL.startsWith('/api/avatar');
        if (!hasCustomAvatar && verifiedPhotoURL) {
            user.photoURL = verifiedPhotoURL;
        }

        // Set recovery email if none (Google email is auto-verified)
        if (!user.email) {
            user.email = email;
            user.emailVerified = true;
        }

        await env.EMAILS.put(session.username, JSON.stringify(user));

        return jsonResponse({
            success: true,
            username: user.displayUsername || session.username.replace(/^user:/, ''),
            photoURL: user.photoURL || null
        });

    } catch (err) {
        console.error('Google link error:', err);
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}
