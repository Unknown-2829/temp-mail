/**
 * Google Sign-In — client-side Firebase module
 * Exposes window.googleLogin() which is called from the auth modal buttons.
 */

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

let _auth = null;

async function getFirebaseAuth() {
    if (_auth) return _auth;
    // Fetch Firebase config from backend (env vars are not available in static JS)
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('Failed to load Firebase config');
    const config = await res.json();
    if (!config.apiKey) throw new Error('Firebase config missing');
    const app = getApps().length ? getApps()[0] : initializeApp(config);
    _auth = getAuth(app);
    return _auth;
}

const GOOGLE_SVG = `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
  <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
  <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
</svg> Continue with Google`;

function resetGoogleBtns() {
    document.querySelectorAll('.google-login-btn').forEach(b => {
        b.disabled = false;
        b.innerHTML = GOOGLE_SVG;
    });
}

window.googleLogin = async function () {
    const errEl = document.getElementById('auth-error');
    if (errEl) errEl.classList.add('hidden');

    document.querySelectorAll('.google-login-btn').forEach(b => {
        b.disabled = true;
        b.textContent = 'Signing in…';
    });

    try {
        const auth = await getFirebaseAuth();
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });

        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        const idToken = await user.getIdToken(/* forceRefresh */ true);

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

        if (res.ok && data.token) {
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('username', data.username);
            localStorage.setItem('isPremium', data.isPremium ? 'true' : 'false');
            if (data.photoURL) localStorage.setItem('photoURL', data.photoURL);
            else localStorage.removeItem('photoURL');
            closeAuth();
            initAuthState();
            showToast(data.isPremium ? '⭐ Welcome, Premium!' : '✅ Signed in with Google!');
        } else {
            const msg = data.error || 'Google sign-in failed';
            if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
        }
    } catch (err) {
        // User closed popup or it was blocked — don't show an error
        if (
            err.code === 'auth/popup-closed-by-user' ||
            err.code === 'auth/cancelled-popup-request'
        ) {
            return;
        }
        const msg =
            err.code === 'auth/popup-blocked'
                ? 'Popup blocked — please allow popups for this site and try again.'
                : (err.message || 'Google sign-in failed. Try again.');
        if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
    } finally {
        resetGoogleBtns();
    }
};

