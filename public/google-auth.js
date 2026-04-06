// ===== FIREBASE GOOGLE AUTH =====
// This module is loaded as type="module" so it can use ES module imports.
// It exposes window.googleLogin for use by inline onclick handlers.
// Firebase config is fetched from /api/config (served from Cloudflare env vars).

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup }
    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

async function initFirebase() {
    const res = await fetch('/api/config');
    const firebaseConfig = await res.json();
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();
    return { auth, provider };
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
