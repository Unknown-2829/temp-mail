# Temp Mail - Disposable Email Service

A temporary email service built for Cloudflare Pages with Email Workers.

## Architecture

```
User Browser (unknownlll2829.qzz.io)
    ↓
Cloudflare Pages (Frontend + API)
    ↓
Cloudflare KV (Storage)
    ↓
Cloudflare Email Worker (Receives emails)
```

## Project Structure
    
```
temp-email/
├── public/
│   ├── index.html    # Main frontend page
│   └── app.js        # Frontend JavaScript
├── functions/
│   └── api/
│       ├── generate.js   # Generate temp email API
│       └── emails.js     # Fetch emails API
├── .gitignore
└── README.md
```

## ⚠️ Demo Deployment Notice (GitHub Pages)

This repository is deployed on GitHub Pages as a **view-only demo**. The fully functional site is available at
**https://unknownlll2829.qzz.io/** and should be used for real temp-mail functionality.

> **Reminder:** Keep this disclaimer visible in all future updates to this README.

### What works on GitHub Pages
- ✅ Static UI, layout, and styling
- ✅ Buttons, modals, and basic client-side interactions

### What does NOT work on GitHub Pages
- ❌ Temp email generation and inbox fetching (`/api/*` endpoints require Cloudflare Pages Functions)
- ❌ QR code generation endpoint (`/api/qr`)
- ❌ Authentication (OTP send/verify)
- ❌ Email worker-backed storage (Cloudflare KV)

### GitHub Pages Deployment Instructions
1. Push changes to the `main` branch.
2. In your GitHub repository settings, set **Pages → Source** to **GitHub Actions**.
3. The workflow at `.github/workflows/deploy.yml` will build and deploy the static site automatically.

## Deployment

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/yourusername/temp-mail.git
git push -u origin main
```

### 2. Connect to Cloudflare Pages

1. Go to Cloudflare Dashboard → Pages
2. Create a project → Connect to Git
3. Select your repository
4. Build settings:
   - Build command: (leave empty)
   - Build output directory: `/public`
5. Deploy

### 3. Bind KV Namespaces

1. Go to Pages project → Settings → Functions
2. Add KV namespace bindings:
   - `TEMP_EMAILS` → Your TEMP_EMAILS KV namespace
   - `EMAILS` → Your EMAILS KV namespace

### 4. Connect Custom Domain

1. Pages project → Custom domains
2. Add: `unknownlll2829.qzz.io`

## Email Worker

Update your email-handler worker to store incoming emails:

```javascript
export default {
  async email(message, env, ctx) {
    try {
      const recipientEmail = message.to;
      const emailData = await env.TEMP_EMAILS.get(recipientEmail);
      
      if (!emailData) {
        message.setReject("Address not found");
        return;
      }
      
      const from = message.from;
      const subject = message.headers.get("subject") || "(No Subject)";
      const rawEmail = await streamToString(message.raw);
      const body = extractEmailBody(rawEmail);
      
      const emailContent = {
        from: from,
        to: recipientEmail,
        subject: subject,
        body: body,
        timestamp: Date.now()
      };
      
      const emailKey = `email:${recipientEmail}:${Date.now()}`;
      await env.EMAILS.put(emailKey, JSON.stringify(emailContent), { expirationTtl: 3600 });
      
    } catch (error) {
      console.error("Error:", error);
    }
  }
};
```

## Features

- ✨ Instant email generation
- 📬 Real-time email checking
- 🔄 Auto-refresh every 5 seconds
- 📋 One-click copy
- ⏱️ 1-hour expiration
- 🔒 Private & secure

## License

MIT
