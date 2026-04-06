// ===== FIREBASE GOOGLE AUTH =====
// This module is loaded as type="module" so it can use ES module imports.
// It exposes window.googleLogin for use by inline onclick handlers.
// Firebase config is fetched from /api/config (served from Cloudflare env vars).

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup }
    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

let _auth = null;
let _provider = null;

async function initFirebase() {
    if (_auth && _provider) return { auth: _auth, provider: _provider };
    const res = await fetch('/api/config');
    const firebaseConfig = await res.json();

    // Prevent duplicate app error if somehow called twice
    const app = getApps().length === 0
        ? initializeApp(firebaseConfig)
        : getApps()[0];

    _auth = getAuth(app);
    _provider = new GoogleAuthProvider();
    return { auth: _auth, provider: _provider };
}

async function googleLogin() {
    try {
        const { auth, provider } = await initFirebase();
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        const idToken = await user.getIdToken();

        const res = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                idToken,
                email: user.email,
                name: user.displayName,
                uid: user.uid,
                photoURL: user.photoURL
            })
        });

        const data = await res.json();

        if (data.success && data.token) {
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('username', data.username);
            localStorage.setItem('isPremium', data.isPremium ? 'true' : 'false');
            window.closeAuth?.();
            window.closePremiumFlow?.();
            window.initAuthState?.();
            window.showToast?.(data.isPremium ? '⭐ Welcome back, Premium!' : '✅ Signed in with Google!');
        } else {
            window.showAuthError?.(data.error || 'Google login failed');
        }
    } catch (err) {
        if (err.code === 'auth/popup-closed-by-user') return;
        console.error('Google login error:', err);
        window.showAuthError?.('Google login error: ' + err.message);
    }
}

window.googleLogin = googleLogin;
// ===== END FIREBASE GOOGLE AUTH =====
