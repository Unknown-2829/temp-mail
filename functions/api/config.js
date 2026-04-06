/**
 * Firebase Config endpoint
 * GET /api/config
 * Returns Firebase configuration from Cloudflare environment variables.
 * Cloudflare Pages Functions have access to env vars; static frontend JS does not.
 */
export async function onRequestGet(context) {
    const { env } = context;
    return Response.json({
        apiKey: env.FIREBASE_API_KEY,
        authDomain: env.FIREBASE_AUTH_DOMAIN,
        projectId: env.FIREBASE_PROJECT_ID,
        appId: env.FIREBASE_APP_ID,
        messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
        measurementId: env.FIREBASE_MEASUREMENT_ID
    });
}
