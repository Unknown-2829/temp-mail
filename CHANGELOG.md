# Changelog

All notable changes to Phantom Mail will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-04-05

### 🚀 Major Update — Attachment Overhaul, Source View, Server-Side Delete & Email Rendering Fixes

This release is a large batch of 6 pull requests (PRs #27–#32) covering 21 commits. It introduces Cloudflare R2 attachment storage (up to 50 MB), an inline attachment viewer with lightbox and PDF preview, a raw source view toggle, server-side email deletion, and a wide range of email rendering and decoding fixes.

### ✨ New Features

#### Attachments — R2 Storage & Rich Viewer
- **R2 bucket integration** — email-handler now stores attachments in Cloudflare R2 (`ATTACHMENTS` binding) instead of KV, raising the per-attachment limit from 1 MB to **50 MB**
- **Inline attachment preview** — images are displayed in a responsive grid; clicking opens a full-screen **lightbox** viewer
- **Inline PDF rendering** — PDF attachments render directly inside the email viewer via `<iframe>` with no download required
- **Download button** — every attachment card (images, PDFs, and all other file types) now has a dedicated download button
- New `/api/attachment` endpoint (`functions/api/attachment.js`) serves R2 objects with correct `Content-Disposition` and MIME types; PDFs are served inline

#### Server-Side Email Deletion
- **Delete from KV** — the new `/api/delete` endpoint (`functions/api/delete.js`) removes email records and their R2 attachments from storage server-side; previously deletion was client-side only

#### Raw Source View
- **Source toggle button** in the email modal — switch between rendered view and raw email source with one click
- Includes a **copy-to-clipboard** button in source view for easy access to raw headers and body

#### Inbox UX
- **Scrollable inbox** — inbox list now has a fixed `max-height` with `overflow-y: auto` so it never pushes page content down
- **Auto-scroll to top** on refresh so new emails are always visible
- **Inbox scroll position preserved** across re-renders so reading does not jump unexpectedly

#### Email Routing / Worker
- **Real sender extraction** — the email worker now bypasses SMTP bounce/envelope addresses and extracts the true `From:` header so senders display correctly
- **wrangler.toml** added to `email-handler/` with R2 bucket binding, KV namespace bindings, and a **daily cron trigger** configuration for attachment cleanup

#### Scheduled Cleanup
- **R2 cleanup cron job** — runs daily at 03:00 UTC; automatically deletes R2 attachment objects older than **15 days** to keep storage costs low

---

### 🐛 Bug Fixes

#### Attachment & Image Rendering
- Fixed image file attachments silently being dropped and not displayed
- Fixed external images (HTTP) blocked in email HTML due to missing CSP — updated `public/_headers` with `img-src * data: blob:` to allow external images
- Fixed inline CID images (`<img src="cid:...">`) not resolving to attached images
- Fixed attachment cards being unreadable / unstyled

#### Email Body / Encoding
- Fixed **BOM (Byte Order Mark)** at start of email body corrupting HTML parse
- Fixed **em-dash and smart-quote corruption** caused by mis-decoded C1 control bytes (0x80–0x9F range)
- Fixed quoted-printable (QP) decoder producing broken surrogate pairs — replaced with `TextEncoder`-based implementation
- Fixed QP decoder performance — replaced per-iteration regex with char-code hex check
- Fixed **emoji** not rendering in plain-text emails — added emoji font stack (`Segoe UI Emoji`, `Apple Color Emoji`, `Noto Color Emoji`)
- Fixed emoji in QP-encoded subjects and bodies not decoding correctly

#### Email Viewer
- Fixed **CC/BCC recipients** not shown in email header section
- Fixed **PDF inline rendering** not working (correct `Content-Disposition: inline` header)
- Fixed X/Twitter newsletter images not loading (required updated CSP)
- Fixed body content area showing blank when `email.body` was set but the source-view flag was stale
- Fixed source view unintentionally persisting between different emails

#### Polling
- Restored **500 ms initial poll delay** on email open (was incorrectly set to 0 in a prior refactor)
- Faster polling interval for better real-time inbox feel

---

### 🏗️ Infrastructure Changes

| File | Change |
|------|--------|
| `email-handler/worker.js` | R2 attachment upload, real sender extraction, cleanup cron handler |
| `email-handler/wrangler.toml` | **New** — R2 bucket + KV bindings + cron trigger config |
| `functions/api/attachment.js` | **New** — serves R2 attachments with MIME type detection |
| `functions/api/delete.js` | **New** — server-side email + R2 attachment deletion |
| `functions/api/emails.js` | Returns attachment metadata (R2 keys) alongside email data |
| `public/app.js` | Lightbox, source view, inline PDF, attachment grid, QP decoder, inbox scroll |
| `public/styles.css` | Attachment card grid, lightbox overlay, source view panel styles |
| `public/_headers` | Updated CSP — allows external images in email HTML |

### Migration Notes

#### For Self-Hosters
- **New required binding:** Add an `ATTACHMENTS` R2 bucket to both the email worker and Pages project
  - Create bucket in Cloudflare Dashboard → R2 → Create bucket (`phantom-mail-attachments`)
  - Bind as `ATTACHMENTS` in email-handler Worker → Settings → R2 bindings
  - Bind as `ATTACHMENTS` in Pages project → Settings → Functions → R2 bindings
- Deploy the updated `email-handler/worker.js` — it now expects `env.ATTACHMENTS` (R2 bucket)
- Use the new `email-handler/wrangler.toml` when deploying via Wrangler CLI

#### For Users
- No breaking changes to the UI
- Attachments larger than 1 MB (previously dropped silently) will now be stored and displayed
- Emails can be deleted server-side using the trash icon

---

## [1.0.0] - 2026-03-18

### 🎉 Major Release - Legal Compliance & Marketing Update

This release adds comprehensive legal documentation, highlights the 30-day email retention feature for Premium users, and completely rewrites the README with deploy buttons, comparison tables, and enhanced documentation.

### Added - Legal & Compliance
- **Privacy Policy** (`/public/privacy-policy.html`)
  - Data collection transparency (email addresses, IP via Cloudflare, browser info)
  - Retention policies (free: 1hr, premium: 30 days)
  - Third-party disclosure (Cloudflare only)
  - User rights (access, deletion, correction, data export)

- **Terms of Service** (`/public/terms.html`)
  - Service availability and "as-is" terms
  - Prohibited activities (spam, phishing, fraud, illegal signups, abuse)
  - Termination rights and no-refund policy
  - Liability limitations and indemnification

- **Acceptable Use Policy** (`/public/acceptable-use.html`)
  - Clear guidelines on acceptable vs prohibited uses
  - Detailed examples of legitimate vs fraudulent KYC bypass
  - Enforcement procedures and reporting mechanisms
  - Cooperation with law enforcement

- Footer links to all legal pages on `index.html`

### Added - Premium Feature Highlights
- **30-Day Email Retention** now prominently displayed:
  - Premium modal on `index.html` now includes 📅 30-Day Email Retention
  - Homepage hero section comparison line: "Free emails expire in 1 hour. Premium emails last 30 days."
  - Pricing features grid in `premium.html` includes retention feature with 6 total features
  - Comparison table updated with "Email Retention" row (1 hour vs 30 days)

### Added - Documentation
- **Complete README rewrite** with:
  - Badges (License, Live Demo, Cloudflare, GitHub Stars)
  - Deploy to Cloudflare Pages button (one-click deployment)
  - Feature comparison table (Phantom Mail vs Competitors)
  - Visual architecture diagram showing Cloudflare Pages, KV, and Email Worker flow
  - Placeholder screenshots for Inbox, Email Reader, and Premium Dashboard
  - Comprehensive Cloudflare setup guide (8 detailed steps)
  - Developer API documentation with curl examples
  - Contributing guidelines
  - Support links
  - Star History chart
  - Legal links section

### Changed
- Developer API limit in premium modal updated from "1,000 requests/day" to "10,000 requests/day"
- Premium feature grid expanded from 4 to 6 features
- Footer structure reorganized with legal links in separate row

---

## [Pre-1.0.0] - Development History (143 Commits)

### Phase 7: Mobile & Rendering Optimization (Commits 133-143)
- Fix mobile email rendering for all formats (Crunchyroll/FIITJEE/newsletters)
- Prevent horizontal overflow of email content on mobile screens
- Optimize email rendering with iframe isolation and responsive layout
- Fix forwarding cleanup, use-button scroll, and mobile email preview

### Phase 6: Dashboard & API Improvements (Commits 120-132)
- Fix premium dashboard visibility
- Add admin delete account functionality
- Optimize mobile inbox rendering
- Replace SendGrid forwarding with Cloudflare native `message.forward()`
- Add CORS preflight handlers
- Fix API key reliability issues
- Update hosting domain to mail.unknowns.app

### Phase 5: Premium Feature Refinements (Commits 100-119)
- Fix permanent email TTL
- Add mobile Account header button
- Fix mobile signin-row flash
- Improve useSavedEmail UX
- Fix long username breaking nav on premium.html
- Monthly plan green outline styling
- Premium button flash fix
- Remove post-login dashboard/avatar buttons
- Reserve premium emails feature

### Phase 4: Modal & Popup Fixes (Commits 80-99)
- Fix all popups with backdrop blur and slide-up animations
- Fix modals appearing as plain text at page bottom
- Add display:none + @keyframes animations
- Fix profile/confirm modals rendering issues
- Update account button to SVG person icon
- Fix premium popup visibility
- Add glass-card styling to auth modal

### Phase 3: Premium System & Dashboard (Commits 60-79)
- Add profile modal with PATCH/DELETE endpoints
- Add permanent email tab
- Add forwarding tab to premium dashboard
- Add save email button
- Sync API keys across namespaces
- Add comprehensive API docs page
- Replace Delete button with Save button
- Add premium-required prompt
- Add sign-out confirmation modal

### Phase 2: Authentication & Premium UI (Commits 40-59)
- Complete premium system overhaul with username login
- Add admin dashboard for user management
- Replace OTP authentication with username/password
- Add glassmorphism premium modal redesign
- Create premium.html purchase page with 3-step flow
- Add user avatar and auth status bar
- Fix KV namespace bindings
- Add logout button

### Phase 1: Core Features & Initial UI (Commits 1-39)
- Initial Cloudflare Pages deployment
- Rebrand from TempMail to Phantom Mail
- Dark blue theme with glassmorphism
- Real-time inbox with auto-refresh
- Email viewer with sender parsing (50+ services)
- QR code generation for email addresses
- Mobile-responsive layout (stacked on mobile, side-by-side on desktop)
- localStorage persistence for email state
- Loading animations with rotating arrows
- About modal and footer with contact links
- Google AdSense integration
- Notifications system
- Developer API with rate limiting
- Saved emails feature
- Email forwarding for premium users

---

## Key Features Summary

### Free Plan
- ✨ Instant email generation
- 📬 Real-time inbox (5s refresh)
- ⏱️ 1-hour retention
- 🔒 Private & secure
- 📋 One-click copy
- 🔄 Unlimited use

### Premium Plan ($3/mo or $20/yr)
- 💾 8 permanent addresses
- 🎯 Custom usernames
- 📅 30-day email retention ⭐
- 📨 Email forwarding
- 🔌 Developer API (10,000/day)
- 🛡️ Priority support

---

## Migration Notes

### For Users
- No breaking changes
- All existing accounts and emails remain intact
- Legal pages are informational only

### For Self-Hosters
- No infrastructure changes required
- Legal pages are automatically available at:
  - `/privacy-policy.html`
  - `/terms.html`
  - `/acceptable-use.html`
- Footer automatically includes legal links

### For Developers
- No API changes
- Developer API documentation remains at `/api-docs.html`
- Rate limits unchanged: 100/day (free), 10,000/day (premium)

---

## Security & Compliance

This release adds comprehensive legal documentation to ensure compliance with privacy regulations and establish clear terms of service. The new legal pages cover:

- **Data Protection**: Clear disclosure of data collection and retention
- **User Rights**: Access, deletion, correction, and data export
- **Terms of Service**: Service availability, user responsibilities, liability limitations
- **Acceptable Use**: Clear guidelines on prohibited activities and enforcement

---

## Credits

- **Developer**: Unknown-2829
- **Contributors**: All GitHub contributors
- **Infrastructure**: Cloudflare Pages, Workers, KV, Email Routing
- **License**: MIT

---

## Links

- **Live Demo**: https://mail.unknowns.app
- **GitHub**: https://github.com/Unknown-2829/Phantom-mail
- **API Docs**: https://mail.unknowns.app/api-docs.html
- **Telegram**: https://t.me/unknownlll2829
- **Support**: https://buymeacoffee.com/unknownlll2829

---

[1.0.0]: https://github.com/Unknown-2829/Phantom-mail/releases/tag/v1.0.0
