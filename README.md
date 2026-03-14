# Phantom Mail - Disposable Email Service

A temporary email service built for Cloudflare Pages with Email Workers.

## Architecture

```
User Browser (mail.unknowns.app)
    ↓
Cloudflare Pages (Frontend + API Functions)
    ↓
Cloudflare KV (Storage)
    ↓
Cloudflare Email Worker (Receives inbound emails)
```

## Project Structure
    
```
phantom-mail/
├── public/
│   ├── index.html        # Main frontend page
│   └── app.js            # Frontend JavaScript
├── functions/
│   └── api/
│       ├── generate.js       # Web UI: generate temp email
│       ├── emails.js         # Web UI: fetch emails for address
│       ├── qr.js             # QR code generation proxy
│       ├── auth/
│       │   ├── signin.js     # POST /api/auth/signin
│       │   └── signup.js     # POST /api/auth/signup
│       ├── user/
│       │   ├── api-key.js    # GET/POST /api/user/api-key
│       │   ├── profile.js    # GET/PATCH/DELETE /api/user/profile
│       │   ├── saved-emails.js  # Premium saved addresses
│       │   └── forwarding.js    # Premium email forwarding
│       ├── v1/
│       │   ├── generate.js   # Developer API: POST /api/v1/generate
│       │   └── emails.js     # Developer API: GET /api/v1/emails
│       └── admin/
│           └── [[action]].js # Admin panel API
├── email-handler/
│   └── worker.js         # Cloudflare Email Worker (deploy separately)
└── README.md
```

## Full Cloudflare Setup Checklist

### 1. Create KV Namespaces

In the Cloudflare Dashboard → Workers & Pages → KV, create these four namespaces:

| Binding name | Purpose |
|---|---|
| `EMAILS` | Users, sessions, saved addresses, received email content, forwarding rules |
| `TEMP_EMAILS` | Temp email address registry (1-hour TTL) |
| `API_KEYS` | Developer API key lookup for `/api/v1/*` endpoints |
| `API_USAGE` | Daily rate-limit counters for developer API keys |

### 2. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/yourusername/phantom-mail.git
git push -u origin main
```

### 3. Connect to Cloudflare Pages

1. Go to Cloudflare Dashboard → Workers & Pages → Create → Pages
2. Connect to Git → select your repository
3. Build settings:
   - Build command: *(leave empty)*
   - Build output directory: `public`
4. Deploy

### 4. Bind KV Namespaces to Pages

1. Go to your Pages project → Settings → Functions → KV namespace bindings
2. Add all four bindings created in step 1:
   - Variable name `EMAILS` → select the `EMAILS` KV namespace
   - Variable name `TEMP_EMAILS` → select the `TEMP_EMAILS` KV namespace
   - Variable name `API_KEYS` → select the `API_KEYS` KV namespace
   - Variable name `API_USAGE` → select the `API_USAGE` KV namespace
3. Re-deploy the Pages project after adding bindings (Settings → Deployments → Retry)

### 5. Set Environment Variables on Pages

Go to Pages project → Settings → Environment variables and add:

| Variable | Required | Description |
|---|---|---|
| `ADMIN_SECRET` | **Yes** | Password for `/api/admin/login`. Without this, the admin panel is inaccessible. |
| `SENDGRID_API_KEY` | No | Enables the email forwarding feature (premium). Leave unset to disable forwarding. |

### 6. Connect Custom Domain

1. Pages project → Custom domains → Set up a custom domain
2. Add: `mail.unknowns.app`
3. Follow Cloudflare's DNS verification steps

### 7. Deploy the Email Worker

The `email-handler/worker.js` is a separate **Cloudflare Worker** that receives inbound emails. It must be deployed independently of Pages.

1. Go to Workers & Pages → Create → Worker
2. Upload / paste the contents of `email-handler/worker.js`
3. Bind the **same** KV namespaces to the worker:
   - Variable name `EMAILS` → `EMAILS` KV namespace
   - Variable name `TEMP_EMAILS` → `TEMP_EMAILS` KV namespace
4. *(Optional)* Add the `SENDGRID_API_KEY` secret to the worker as well if you want forwarding

### 8. Configure Email Routing

This routes inbound emails for your domain to the email worker.

1. Go to Cloudflare Dashboard → Email → Email Routing
2. Select the domain used by your mail addresses (`unknownlll2829.qzz.io` or your own)
3. Under **Routing rules**, add a catch-all rule:
   - Action: **Send to a Worker**
   - Destination: select the email worker deployed in step 7
4. Enable Email Routing for the domain if not already enabled

> ⚠️ Without this step, emails sent to generated addresses will never arrive.

---

## Developer API

Base URL: `https://mail.unknowns.app`

All `/api/v1/*` endpoints require the header `X-API-Key: YOUR_KEY`.

Get or regenerate your API key from the Premium Dashboard, or call:

```bash
# Fetch your key (also syncs it to the API_KEYS namespace)
curl https://mail.unknowns.app/api/user/api-key \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"

# Generate a new key
curl -X POST https://mail.unknowns.app/api/user/api-key \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"
```

### POST /api/v1/generate

```bash
curl -X POST https://mail.unknowns.app/api/v1/generate \
  -H "X-API-Key: pm_..." \
  -H "Content-Type: application/json"
```

### GET /api/v1/emails

```bash
# Replace the address below with any email generated by this service (on unknownlll2829.qzz.io)
curl "https://mail.unknowns.app/api/v1/emails?address=cool.user@unknownlll2829.qzz.io" \
  -H "X-API-Key: pm_..."
```

Rate limits: 100 requests/day (free) · 10,000 requests/day (premium)

---

## Features

- ✨ Instant email generation
- 📬 Real-time email checking
- 🔄 Auto-refresh every 5 seconds
- 📋 One-click copy
- ⏱️ 1-hour expiration
- 🔒 Private & secure
- 🔑 Developer API with API key authentication
- ⭐ Premium: saved permanent addresses, email forwarding, higher API limits

## License

MIT
