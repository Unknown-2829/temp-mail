# Changelog

All notable changes to Phantom Mail are documented here.  
Every meaningful commit is listed — grouped by feature area — with a plain-English explanation of **what changed and why it matters**.

---

## [1.3.2] — 2026-04-06

### Login & Signup UX Improvements (3 targeted fixes)

This release fixes the admin login rate-limit error always showing the wrong message, and modernises the sign-in / sign-up UI with proper Enter-key navigation, password-manager autofill, and field labels.

---

#### 1 · Admin Login Error Now Shows the Real Server Message (`public/admin.html`)

**What was wrong:** The admin login card always displayed "Invalid secret. Access denied." even when the server returned a different error — for example, the 429 rate-limit message "Too many login attempts. Try again in 15 minutes.".

**What changed:**
- The `<p>` error element is now empty by default; its text is set from `data.error` at runtime.
- The `catch` block now shows "Network error. Try again." instead of the generic access-denied text.
- Added `role="alert"` and `aria-live="polite"` for screen-reader accessibility.

**Files changed:** `public/admin.html`

---

#### 2 · Enter-Key Navigation & Autofill on All Login Forms (`public/index.html`, `public/admin.html`)

**What was wrong:** The sign-in and sign-up inputs had no `name` attributes and were not wrapped in a `<form>`, so:
- Pressing Enter did nothing (no form submission).
- Browsers and password managers could not reliably recognise the credential fields.
- The admin secret field had `autocomplete="off"`, blocking password-manager autofill entirely.

**What changed:**
- Sign-in and sign-up inputs are now wrapped in `<form>` elements with `onsubmit` handlers, so pressing **Enter** in any field advances to the next field and submits on the last field — no extra code needed.
- All inputs now have `name` attributes (`username`, `password`, `email`) to maximise browser autofill and credential-saving.
- Submit buttons are now `type="submit"` for correct semantic behaviour.
- Admin secret input changed from `autocomplete="off"` to `autocomplete="current-password"` so password managers can fill it.

**Files changed:** `public/index.html`, `public/admin.html`

---

#### 3 · Field Labels Added to Sign-In / Sign-Up Modal (`public/index.html`, `public/styles.css`)

**What was wrong:** The auth modal only used placeholder text — once a user starts typing, there is no visual reminder of which field is which, making the form feel cheap and difficult to use.

**What changed:**
- Visible `<label>` elements added above every input field ("Username", "Password", "Recovery Email (optional)").
- New `.auth-label` and `.auth-optional` CSS classes provide consistent 12 px uppercase label styling that matches the admin panel's existing field-label style.

**Files changed:** `public/index.html`, `public/styles.css`

---

## [1.3.1] — 2026-04-06

### Fix Broken Email Generation & Harden Admin Login (3 targeted fixes)

v1.3.0 locked `POST /api/generate` behind a hard 401 for all unauthenticated requests, breaking the core email-generation feature for every guest user. This patch restores guest access via IP-based rate limiting, passes the auth token from the frontend when available, and adds brute-force protection to the admin login endpoint.

---

#### 1 · Guest Email Generation Restored (`functions/api/generate.js`)

**What was wrong:** The v1.3.0 session-token check rejected every request without an `Authorization` header with a 401, causing all unauthenticated users to see "Error - Tap Regenerate".

**What changed:**
- Removed the hard 401 block for missing/invalid tokens.
- Authenticated users (valid `session:{token}` in KV) continue to get **unlimited** generations.
- Unauthenticated users are now rate-limited instead of rejected: up to **30 email generations per IP per day**, tracked in `env.EMAILS` under `ratelimit:gen:{ip}:{YYYY-MM-DD}` with a 24-hour TTL (`expirationTtl: 86400`). The IP is read from the `CF-Connecting-IP` header.
- Exceeding the anonymous limit returns `429 Too Many Requests` with a JSON error message.
- All existing email-generation logic is unchanged.

**Files changed:** `functions/api/generate.js`

---

#### 2 · Auth Token Forwarded from Frontend (`public/app.js`)

**What was wrong:** `generateEmail()` called `POST /api/generate` with no headers, so logged-in users were also being rate-limited (or rejected) even though they had a valid session token in `localStorage`.

**What changed:**
- `generateEmail()` now reads `authToken` from `localStorage`.
- If a token is present, it is sent as `Authorization: Bearer <token>`.
- If no token is present (guest), the request is sent with no auth header (triggering the IP rate limit path on the server).

**Files changed:** `public/app.js`

---

#### 3 · Brute-Force Protection on Admin Login (`functions/api/admin/[[action]].js`)

**What was wrong:** `POST /api/admin/login` had no attempt limiting — an attacker could try the admin secret an unlimited number of times.

**What changed:**
- Added IP-based attempt tracking using `env.EMAILS` under `ratelimit:admin:login:{ip}` with a 15-minute TTL (`expirationTtl: 900`).
- Maximum **10 failed attempts per IP per 15 minutes**. Exceeding the limit returns `429 Too Many Requests`.
- The counter increments only on a failed (wrong secret) attempt.
- On a successful login the counter is deleted so the IP is not penalized for future sessions.

**Files changed:** `functions/api/admin/[[action]].js`

---

## [1.3.0] — 2026-04-05

### Security & UX Hardening (6 targeted fixes)

This release fixes six independent bugs discovered after v1.2.0: a hidden API Key tab for free users, two CSP gaps that silently blocked third-party scripts, an unprotected QR endpoint, an unauthenticated internal email-generation endpoint, and noisy console spam during network hiccups.

---

#### 1 · API Key Tab Hidden from Free Users (`public/app.js`)

**What was wrong:** `updatePremiumDashboard()` called `closePremiumDashboard()` and returned early whenever `isPremium` was `false`. This hid the entire dashboard — including the API Key tab — from free users, even though the backend `/api/user/api-key` has no premium requirement and allows 100 keys/day for free accounts.

**What changed:**
- `updatePremiumDashboard()` was rewritten. It now always shows the dashboard for any logged-in user.
- The dashboard **title** changes based on tier: `⭐ Premium Dashboard` for premium, `🔌 Developer Dashboard` for free.
- **Free users** only see the `🔌 API Key` tab (the Saved Emails and Forwarding tabs are hidden with `.hidden`).
- **Premium users** see all three tabs: `📁 Saved Emails`, `📨 Forwarding`, `🔌 API Key`.
- `loadApiKey()` is always called on dashboard open; `loadSavedEmails()` is gated behind `isPremium`.
- Default active tab: `saved` for premium, `apikey` for free.

**Files changed:** `public/app.js`

---

#### 2 & 3 · AdSense and Cloudflare Analytics Blocked by CSP (`public/_headers`)

**What was wrong:** The `Content-Security-Policy` header was missing several domains required by Google AdSense and the Cloudflare Analytics beacon (which is auto-injected at the edge and not present in source):
- AdSense JS was blocked — `script-src` didn't allow `pagead2.googlesyndication.com`.
- Beacon connection requests failed — `connect-src` only allowed `'self'`.
- Ad iframes were blocked — `frame-src` didn't allow `googleads.g.doubleclick.net`.
- The Cloudflare Analytics script was blocked — `static.cloudflareinsights.com` was missing from `script-src`.

**What changed in `script-src`:** Added `https://pagead2.googlesyndication.com` and `https://static.cloudflareinsights.com`.

**What changed in `connect-src`:** Added `https://pagead2.googlesyndication.com`, `https://googleads.g.doubleclick.net`, `https://www.googletagservices.com`, and `https://cloudflareinsights.com`.

**What changed in `frame-src`:** Added `https://googleads.g.doubleclick.net` and `https://tpc.googlesyndication.com`.

**Files changed:** `public/_headers`

---

#### 4 · QR Endpoint Had No Rate Limiting (`functions/api/qr.js`)

**What was wrong:** `GET /api/qr?email=...` had zero authentication and zero rate limiting. Anyone could call it in an infinite loop, hammering the upstream QRServer.com API and burning Cloudflare Workers invocations.

**What changed:**
- Added IP-based rate limiting using the `CF-Connecting-IP` request header.
- A counter is stored in the `TEMP_EMAILS` KV namespace under the key `ratelimit:qr:{ip}:{YYYY-MM-DD}` with a 24-hour TTL (`expirationTtl: 86400`).
- Limit is **30 requests per IP per day**. Exceeding it returns `429 Too Many Requests` with a JSON error message.
- The existing `Cache-Control: public, max-age=3600` response header is preserved so cached QR responses still bypass the counter.

**Files changed:** `functions/api/qr.js`

---

#### 5 · Internal `/api/generate` Had No Authentication (`functions/api/generate.js`)

**What was wrong:** `POST /api/generate` (the internal human-name email generator used by the UI — not the public `/api/v1/generate`) responded to any caller with `Access-Control-Allow-Origin: *` and no session check. Anyone who discovered the endpoint could generate unlimited email addresses without an API key or rate limit.

**What changed:**
- Added a session token check at the top of `onRequestPost()`.
- The handler reads the `Authorization: Bearer <token>` header, then looks up `session:{token}` in `env.EMAILS` KV.
- If the header is missing or the session does not exist, the request is rejected with `401 Unauthorized` JSON.
- All existing email-generation logic is unchanged — only authenticated users reach it.

**Files changed:** `functions/api/generate.js`

---

#### 6 · Refresh Network Errors Spammed the Console (`public/app.js`)

**What was wrong:** When `refreshEmails()` encountered a network failure (tab backgrounded, device offline, Cloudflare edge temporarily unreachable), `console.error('Refresh error #N', e)` was called on every retry. This produced long error chains in browser consoles, cluttering user-reported bug reports.

**What changed:**
- `console.error` is now only called when `_refreshErrorCount === 1` — i.e., the very first failure.
- All subsequent retries during the same backoff cycle are silent.
- The existing exponential backoff logic (5 s → 10 s → 20 s → 60 s cap) is completely unchanged.

**Files changed:** `public/app.js`

---

## [1.2.0] — 2026-04-05

### Attachment Overhaul, Source View, Server-Side Delete & Full Email Rendering Fix

This release covers **PRs #27–#32** (16 meaningful commits). It introduces Cloudflare R2 attachment storage, a lightbox viewer, raw source view, server-side delete, scheduled cleanup, and a large batch of email-rendering and character-encoding fixes.

---

#### Group 1 · Foundation: R2 Attachments, Real Sender, Server Delete (`76b3b62`)

The single biggest commit in this release. Changed **5 files, +268 lines**.

**`email-handler/worker.js`**
- Attachment size limit raised from **1 MB to 50 MB** — attachments are now uploaded to Cloudflare R2 (`ATTACHMENTS` bucket) instead of being base64-encoded into KV.
- Each attachment is stored at `attachments/{recipient}/{timestamp}_{index}_{filename}` in R2; the base64 `data` field is deleted from the KV record to prevent bloat.
- Added `extractRealFrom()` helper — prefers the RFC 5322 `From:` header over the SMTP envelope address (which is often a bounce/postmaster address), so sender names display correctly.
- `from`, `replyTo` headers are now stored alongside each email record.
- Stream-to-string conversion now collects all `Uint8Array` chunks before decoding, preventing split multi-byte sequences (emoji) from being corrupted at chunk boundaries.

**`functions/api/attachment.js`** *(new file)*
- `GET /api/attachment?key=attachments/...` serves R2 objects with correct `Content-Type` and `Content-Disposition` headers.
- PDFs are served with `Content-Disposition: inline` so they open in-browser; all other types use `attachment` (forced download).
- Only keys starting with `attachments/` are served — path traversal is not possible.

**`functions/api/delete.js`** *(new file)*
- `DELETE /api/delete` removes the email record from KV **and** deletes all associated R2 attachment objects.
- Previously, clicking delete was client-side only (the record stayed in KV until it expired).

**`functions/api/emails.js`**
- Now returns `r2Key` fields from attachment objects alongside email metadata, so the frontend can request attachment data from `/api/attachment`.

**`public/app.js`**
- Lightbox viewer added for images.
- Inline `<iframe>` PDF viewer added.
- Attachment grid layout implemented.
- Quoted-printable (QP) decoder added for correct subject/body decoding.
- Exponential backoff on polling errors (5 s → 10 s → 20 s → 60 s cap).

---

#### Group 2 · Cleanup Cron & Code Quality (`73faf8c`, `f0049fa`)

**`73faf8c` — Scheduled R2 cleanup cron job + `wrangler.toml`**
- Added `email-handler/wrangler.toml` with KV bindings, R2 bucket binding, and a `[triggers]` cron schedule (`0 3 * * *` — 03:00 UTC daily).
- The cron handler lists all R2 objects and deletes any attachment older than **15 days**, keeping storage costs low automatically.

**`f0049fa` — Code review fixes**
- Replaced a broad regex in filename sanitization with a safer character-allowlist check.
- Fixed `setInterval` timer leak — old timer is now cleared before starting a new one.
- Corrected `Content-Disposition` header casing.
- Replaced `Math.min(…)` with `Math.max(…)` in the right place for the backoff cap.

---

#### Group 3 · Emoji Rendering & Attachment Preview (`acf0763`)

**`public/app.js`**
- Added emoji font stack to plain-text email rendering: `Segoe UI Emoji`, `Apple Color Emoji`, `Noto Color Emoji` — emoji now render on all OS/browser combinations.
- Rich attachment inline preview implemented: image thumbnails shown in a grid, PDF cards show a document icon, other file types show a generic icon with filename and size.
- Each attachment card has a click handler to open the lightbox or PDF viewer.

**`public/styles.css`**
- Attachment grid, card styles, lightbox overlay, PDF viewer styles added.

---

#### Group 4 · Inbox Scrolling, BOM, CID Images, Lightbox (`74d56dd`, `a414767`)

**`74d56dd` — Preserve inbox scroll position**
- Before re-rendering the email list, the current `scrollTop` of the inbox container is saved.
- After rendering, `scrollTop` is restored, so reading an email and returning to inbox does not jump back to the top.

**`a414767` — BOM, external images, inline CID, attachment grid**
- **BOM stripping:** UTF-8 BOM (`\xEF\xBB\xBF`) at the start of email body is now stripped before HTML parsing, preventing a garbled `﻿` character at the top of rendered emails.
- **External images:** `public/_headers` updated to `img-src * data: blob:`, allowing HTTP-hosted images in email HTML.
- **Inline CID images:** `<img src="cid:...">` references are now resolved — the matching attachment is found by Content-ID and its base64 data URI is injected so inline images display correctly.
- Attachment grid and lightbox styles refined.

---

#### Group 5 · Server Delete, Source View Toggle (`5299e35`)

**`public/app.js`**
- **Server-side delete:** Trash button now calls `DELETE /api/delete` before removing the email from the local list. R2 attachments are cleaned up immediately.
- **Raw source view toggle:** A "Source" button in the email modal switches between rendered HTML view and raw email source (headers + body). Source view includes a "Copy" button for clipboard access.
- Source view flag is reset when a different email is opened, so it never persists across emails.

---

#### Group 6 · Body Content, Source View, Card Styling (`74c8cc5`)

**`public/app.js`**
- Fixed blank body bug: when `email.body` was set but the source-view stale flag was active, the body area showed nothing. The flag is now properly reset on email open.
- Attachment card download UX polished — download function correctly receives email index and attachment index.
- Source view panel styling improved.

---

#### Group 7 · PDF Inline, Emoji QP, CC/BCC, Polling (`26e4c04`)

**`functions/api/attachment.js`**
- PDF attachments are now served with `Content-Disposition: inline; filename="..."` so browsers open them in an `<iframe>` instead of forcing a download.

**`public/app.js`**
- **Emoji in QP-encoded subjects:** quoted-printable decoder now correctly handles multi-byte emoji sequences in `=?UTF-8?Q?...?=` encoded subjects.
- **CC/BCC display:** email header section now shows CC and BCC recipients if present.
- Polling interval reduced for a more real-time inbox feel.

---

#### Group 8 · QP Decoder: TextEncoder + Performance (`f985f0f`, `aa4598e`, `4f23d1a`)

**`f985f0f` — Fix surrogate pair corruption in QP decoder**
- The previous QP decoder accumulated percent-decoded bytes as a JS string, which broke multi-byte sequences (emoji, accented characters) by creating invalid surrogate pairs.
- Replaced with a `TextEncoder`/`TextDecoder` based approach: bytes are collected into a `Uint8Array`, then decoded in one pass with `new TextDecoder('utf-8')`.

**`aa4598e` — Performance: replace regex with char-code check**
- The inner loop of the QP decoder previously called `str.match(/^[0-9A-Fa-f]{2}/)` on every character.
- Replaced with a direct char-code range check (`c >= 48 && c <= 57 || c >= 65 && c <= 70 || ...`), which is significantly faster for large email bodies.

**`4f23d1a` — C1 byte fix, 500 ms poll delay restored**
- Fixed em-dash (`—`) and smart-quote (`"` `"`) corruption: Windows-1252 C1 control bytes (0x80–0x9F range) were being mis-decoded as literal Unicode control characters. A mapping table now converts them to the correct Unicode codepoints.
- Restored the 500 ms initial poll delay on email open that was accidentally removed in an earlier refactor.

---

#### Group 9 · Image Attachments, Download Button (`b6b0ce9`, `437ebd8`)

**`b6b0ce9` — Image attachments disappear fix**
- Image file attachments (JPEG, PNG, GIF, WebP) were being silently dropped during rendering because the attachment-type check used a strict MIME prefix that didn't match all cases.
- Fixed to check `contentType.startsWith('image/')` broadly.

**`437ebd8` — Download button on all attachment types**
- Every attachment card (image, PDF, and generic file) now has a dedicated `⬇ Download` button in the top-right corner.
- Clicking download does not trigger the lightbox/preview — `stopPropagation()` prevents the click from bubbling to the card's open handler.
- Images: `⬇` icon overlay button added to the image cell.
- PDFs and generic files: `⬇ Download` text button added to the card and wired to `downloadAttachment(emailIndex, attachmentIndex)`.

---

## [1.1.0] — 2026-03-18

### Legal Pages, README Rewrite & Documentation Polish

This release adds Privacy Policy, Terms of Service, and Acceptable Use Policy pages; rewrites the README from scratch with badges, deploy buttons, and architecture diagrams; and refines the policy language to be privacy-first.

---

#### Group 1 · Legal Pages + 30-Day Retention Highlight (`703c0f8`)

Three new static HTML pages added under `public/`:

**`public/privacy-policy.html`**
- Documents exactly what data is collected (email addresses, IPs via Cloudflare, browser info).
- States retention policies clearly: free emails expire in **1 hour**, premium emails last **30 days**.
- Lists third-party disclosures (Cloudflare only).
- Covers user rights: access, deletion, correction, data export.

**`public/terms.html`**
- "As-is" service terms and availability disclaimer.
- Prohibited activities: spam, phishing, fraud, illegal account signups, service abuse.
- No-refund policy and liability limitations.

**`public/acceptable-use.html`**
- Acceptable vs prohibited use examples (including legitimate vs fraudulent KYC bypass).
- Enforcement and reporting procedures.

**`public/index.html`** — Footer updated with links to all three legal pages.

**`public/premium.html`** — 📅 30-Day Email Retention added to the premium feature grid (expanded from 4 to 6 features). Developer API daily limit updated from "1,000/day" to "10,000/day".

---

#### Group 2 · Complete README Rewrite (`7431dbd`)

`README.md` rewritten from scratch:
- Badges row: License, Live Demo, Cloudflare, GitHub Stars.
- **Deploy to Cloudflare Pages** one-click button.
- Feature comparison table — Phantom Mail vs competitors (10fastmail, Guerrilla Mail, temp-mail.io).
- Architecture diagram showing Cloudflare Pages → Workers KV → Email Routing → Worker flow.
- Comprehensive 8-step Cloudflare setup guide (KV namespaces, Email Routing, R2, wrangler).
- Developer API documentation with `curl` examples.
- Contributing guidelines and support links.

---

#### Group 3 · Architecture Diagram & Policy Language (`c2da94b`, `0c594c4`, `43865d2`, `e0e958f`, `28822be`)

**`c2da94b` — Add architecture diagram to README**
- Added Mermaid-syntax architecture diagram showing the full data flow.

**`0c594c4` — Replace Mermaid with ASCII art**
- Mermaid diagrams do not render on all GitHub README views.
- Replaced with a detailed ASCII art diagram that renders correctly everywhere.

**`43865d2` — Privacy-first policy language**
- Policy documents reworded to be more privacy-focused.
- Footer layout optimised so legal links don't crowd the main footer content.

**`e0e958f` — Remove aggressive enforcement language**
- Removed references to law enforcement cooperation and account termination clauses that were overly aggressive for a small privacy-focused service.

**`28822be` — Fix typo in service usage warning**
- Minor wording correction in `acceptable-use.html`.

---

#### Group 4 · README Diagram Refresh & Cleanup (`ce7cedf`, `e60f589`, `30b8a7c`, `493bb25`)

**`ce7cedf` — Remove star repo graph**
- Removed Star History chart and "Back to top" link — both were rendering as broken images/links.

**`e60f589` — Refresh README diagram and links**
- Updated API base URL in examples to `https://mail.unknowns.app`.
- Refreshed the ASCII architecture diagram with cleaner formatting.

**`30b8a7c` — Add screenshots to README**
- Added actual screenshots of the inbox, email reader, and premium dashboard to `README.md`.

**`493bb25` — Delete RELEASE_INSTRUCTIONS.md**
- Removed temporary internal release planning file from the repository.

---

## [1.0.0] — 2026-03-14 to 2026-03-15

### Full Premium System, Admin Dashboard & UI Overhaul (PRs #1–#22)

This release represents the first production-ready version of Phantom Mail. It delivers a complete authentication system, premium dashboard, admin panel, profile management, email forwarding, permanent email addresses, developer API docs, and dozens of UI/UX fixes across 22 pull requests.

---

#### Group 1 · Mobile Email Rendering Fixes (PRs #18–#22 — `bc7af3f`, `41f70f4`, `b890c89`, `04eeaec`, `218ae9e`)

**`bc7af3f` — Fix premium dashboard visibility + admin delete account**
- Fixed a CSS bug where the premium dashboard remained hidden after login even for premium users — the `.hidden` class was not being removed correctly.
- Added "Delete Account" functionality to the admin panel (`functions/api/admin/[[action]].js`): admin can now delete any user account and all associated data from KV.
- Mobile inbox: overflow clipping fixed so long email subjects don't break the layout.

**`41f70f4` — Forwarding cleanup, use-button scroll, mobile preview**
- When a forwarding rule is deleted, the associated KV record (`forward:{address}`) is now properly removed on the backend.
- `useSavedEmail()` now scrolls to the top of the page so the user immediately sees the email address they just activated.
- Mobile email preview (subject/sender in inbox row) truncated correctly with `text-overflow: ellipsis`.

**`b890c89` — iframe isolation + responsive layout + special characters**
- HTML emails now render inside a sandboxed `<iframe srcdoc="...">` with `allow-same-origin` but no `allow-scripts`, preventing injected scripts from running.
- Responsive `<meta name="viewport">` tag injected into the iframe so newsletter HTML that relies on viewport units renders correctly.
- Special characters (`&amp;`, `&lt;`, etc.) in plain-text emails decoded before display.

**`04eeaec` — Prevent horizontal overflow on mobile**
- Added `max-width: 100%; overflow-x: hidden` to the email body container in `styles.css`.
- Wide HTML emails (newsletters, marketing) that used fixed pixel widths no longer cause horizontal scrollbars on mobile.

**`218ae9e` — Fix rendering for Crunchyroll, FIITJEE, newsletter formats**
- Identified specific rendering failures with HTML email layouts from Crunchyroll (wide table layouts) and FIITJEE (inline-block heavy).
- Applied targeted CSS overrides inside the email iframe: `table { max-width: 100% !important }`, `img { max-width: 100% }`, `word-break: break-word`.

---

#### Group 2 · API Infrastructure: Forwarding, CORS, Domain (`b89d5e9`, `2a630d2`, `322d210`)

**`b89d5e9` — Replace SendGrid forwarding with Cloudflare native `message.forward()`**
- The previous email forwarding implementation made an outbound HTTP call to `https://api.sendgrid.com/v3/mail/send`, requiring a paid SendGrid API key (`env.SENDGRID_API_KEY`) and an external dependency.
- Replaced entirely with Cloudflare Email Routing's native `message.forward(forwardTo)` call — no API key needed, no external service, no extra cost.
- The forwarding logic in `email-handler/worker.js` went from ~35 lines (HTTP request construction) to 2 lines.

**`2a630d2` — CORS preflight handlers + null guards + README Cloudflare guide**
- Added `onRequestOptions` handlers to all API routes that were missing them, so browser `OPTIONS` preflight requests succeed.
- Added null/undefined guards for `env.TEMP_EMAILS.get()` calls — previously an empty KV response could cause a `TypeError` crash.
- Fixed `parseInt(NaN)` in the email count logic — added a fallback to `0`.
- README updated with a complete 8-step Cloudflare Pages + Workers setup guide.

**`322d210` — Update hosting domain to mail.unknowns.app**
- All hardcoded URLs in `README.md` and `public/api-docs.html` updated from the old Cloudflare Pages subdomain to `https://mail.unknowns.app`.

---

#### Group 3 · Premium Feature Polish (`842c1a0`, `f6e06aa`, `8830eac`, `7c575d0`)

**`842c1a0` — Permanent email TTL fix, useSavedEmail UX, dead code cleanup**
- Permanent (saved) email addresses were being created in KV without an expiration, but later reads expected `isPermanent: true` — mismatch caused them to be treated as expired. Fixed by always including `isPermanent: true` in the stored JSON.
- `useSavedEmail()` function rewired to properly set `currentEmail`, start auto-refresh, and schedule a render in the correct order.
- Removed several dead code branches in `app.js` that were never reached.

**`f6e06aa` — Mobile Account header button + signin-row flash fix**
- Added an "Account" button to the mobile header that opens the sign-in/profile modal — previously mobile users had no visible account access.
- Fixed a flash of the sign-in row on page load for already-authenticated users: the row is now hidden via CSS before `initAuthState()` runs, preventing the visible pop-in.

**`8830eac` — Long username nav break, monthly plan outline, sign-in relocation**
- Long usernames (20+ chars) were overflowing the navigation bar on `premium.html`. Fixed with `max-width` + `overflow: hidden` + `text-overflow: ellipsis`.
- Monthly plan pricing card now has a green outline to indicate the recommended plan.
- Sign-in button moved on mobile to a more accessible location in the header.
- Fixed a premium button flash caused by a CSS `transition` firing immediately on page load.

**`7c575d0` — Remove post-login dashboard/avatar buttons + reserve premium emails**
- After login, a "Dashboard" button and avatar circle were appearing in the header. These were removed — the Account SVG button is the single entry point to the dashboard.
- Added "reserve" logic for premium email addresses: when a user saves a permanent address, it is immediately written to `env.EMAILS` KV to prevent another user from generating the same address.
- Monthly plan pricing card green outline applied consistently.

---

#### Group 4 · Modal & Popup Bug Fixes (`20bd328`, `1e4128c`, `ae9f777`, `1bb159e`, `7e07c85`)

**`20bd328` + `1e4128c` — Modals rendering as unstyled text at bottom of page**
- Profile and confirm modals were rendering as plain unstyled text at the very bottom of the document because they were using `style="display:none"` toggled to `display:block`, which bypassed the CSS class system.
- Fixed by switching all modals to use `display:none` as a CSS class baseline + `@keyframes slideUp` animation that fires when the modal is shown.
- Both the modal backdrop and panel animate in smoothly.

**`ae9f777` — Full codebase audit: critical bugs, security vulns, dead code**
- This was a wide-ranging audit commit touching 10 files:
  - `functions/api/generate.js`: dangerous email patterns removed from the name generator.
  - `functions/api/auth/signin.js` + `signup.js`: input validation tightened; password length minimum enforced.
  - `functions/api/emails.js`: prevent KV scan on empty address parameter.
  - `functions/api/qr.js`: error response now always returns JSON (was plain text on some paths).
  - `functions/api/user/api-key.js` + `forwarding.js` + `saved-emails.js`: missing `try/catch` blocks added.
  - `email-handler/worker.js`: unhandled promise rejections wrapped.
  - `public/app.js`: several `innerHTML` assignments switched to `textContent` where user input was involved.
  - `public/admin.html` + `premium.html`: missing CSRF-like checks noted and handled client-side.

**`1bb159e` — Account SVG button + premium prompt + glass-card auth modal**
- After signing in, the Account button now renders as an SVG person icon instead of a text "Account" label.
- If a free user tries to access a premium feature, a prompt now slides in explaining the feature requires a premium account and linking to `premium.html`.
- The sign-in/sign-up modal now has a glass-card (`backdrop-filter: blur`) visual treatment matching the rest of the UI.

**`7e07c85` — All popups: backdrop blur, slide-up animation, round close buttons**
- Every popup/modal in the app (about, premium preview, sign-in, profile, confirm) was audited and given:
  - `backdrop-filter: blur(8px)` overlay
  - `@keyframes slideUp` entrance animation (200 ms)
  - Round `✕` close button with hover state
- Redundant `profile-btn` element removed from HTML.
- Account button updated to SVG person icon across all relevant pages.

---

#### Group 5 · Premium Popup & Dashboard Visibility (`024f267`, `d8d1586`, `cd97bd0`, `08ee922`)

**`024f267` — Fix popup visibility with visibility:hidden**
- Premium preview popup was appearing briefly on page load (a 1-frame flash) because it was positioned off-screen but still visible.
- Added `visibility: hidden` to the default state; toggled to `visibility: visible` only when the popup is opened.
- Pricing section CSS in the premium popup corrected — columns were collapsing on some viewport widths.

**`d8d1586` — Fix premium popup, dashboard button, saved emails, profile modal, footer layout**
- Premium popup z-index raised so it appears above the navigation bar.
- Dashboard button was visible for non-premium users — now only shown after confirming `isPremium === true`.
- Saved emails list re-renders correctly after adding or removing an address.
- Profile modal layout fixed: fields were overflowing their container on narrow screens.
- Footer links re-ordered to maintain a logical visual hierarchy.

**`cd97bd0` — Replace Delete button with Save button + premium-required prompt**
- The primary action button in the email header was "Delete". This was changed to "💾 Save" — a more common user action. Delete was moved to a secondary icon button.
- When a non-premium user clicks "Save Email", a modal now explains that saved/permanent email addresses are a premium feature.
- On account deletion (from the profile modal), all associated data (saved emails, forwarding rules, API key) is cleaned up from KV.

**`08ee922` — Profile PATCH/DELETE endpoints, sign-out confirm, pricing popup improvements**
- `PATCH /api/user/profile` endpoint added — allows updating display name and password.
- `DELETE /api/user/profile` endpoint added — deletes account and all KV records.
- Sign-out now shows a confirmation modal instead of signing out immediately.
- Touch/tap events added to all modal close buttons for mobile Safari compatibility.
- Pricing popup vertical scroll added for small-screen mobile.

---

#### Group 6 · Profile Modal, Forwarding Tab, API Docs, Premium Popup (`ef9603a`, `6df7c16`)

**`ef9603a` — Profile modal, permanent email tab, forwarding tab, API docs**
This is one of the largest feature commits, adding multiple new UI panels:

- **Profile modal:** shows username, plan type, expiry date, avatar initial. Contains "Upgrade" CTA and "Sign Out" button. Opened by clicking the Account SVG icon when logged in.
- **Permanent Email tab** in premium dashboard: input field + `@unknownlll2829.qzz.io` suffix label. Validates username with `/^[a-z0-9._-]+$/` regex. Calls `POST /api/user/saved-emails` to reserve the address.
- **Forwarding tab** in premium dashboard: lists all saved permanent addresses, each with an input field to set a forwarding destination. Calls `POST/DELETE /api/user/forwarding`.
- **Save Email button** (`💾 Save`) in the main inbox toolbar, visible only to premium users.
- **API key syncing:** `handlePost` and `handleGet` in `api-key.js` now write the key to both `EMAILS` and `API_KEYS` KV namespaces to keep them in sync.
- **`public/api-docs.html`** *(new file)*: comprehensive developer API documentation with endpoint reference, request/response examples, and `curl` snippets.

**`6df7c16` — Fix premium popup + profile page + forwarding UI**
- Consolidated all the above changes, fixed remaining CSS issues with the premium popup overlay, and verified the forwarding UI list updates correctly on save/delete.

---

#### Group 7 · Sign-In UI, Premium Popup CSS (`b114dc6`, `d9f9f64`, `c90bd14`)

**`b114dc6` — Sign-in button CSS, premium popup, desktop header, plan pre-selection**
- Sign-in button was inheriting incorrect font-size from a parent rule — fixed explicitly.
- Premium popup modal shadow and border-radius corrected.
- Desktop header flex layout adjusted so nav links don't compress the account button area.
- When linking to `premium.html?plan=monthly` or `?plan=yearly`, the corresponding plan card is pre-highlighted on load.

**`d9f9f64` — Fix pv-overlay visibility transition + inline error messages**
- `pv-overlay` (premium preview overlay) transition was firing on page load causing a visible flash.
- Fixed by setting `transition: none` initially and enabling it after the first open.
- `alert()` dialogs replaced with inline `<p class="error-msg">` elements throughout `premium.html`.

**`c90bd14` — Sign-in/out, premium state refresh, popup CSS, desktop layout, plan selection**
- After signing in, `isPremium` flag was not being refreshed — the UI could show the wrong plan. Fixed by re-fetching the user record on every `initAuthState()` call.
- Sign-out now clears `localStorage` correctly (token + username + isPremium).
- Premium popup CSS: backdrop blur, correct stacking context, close button position.
- Desktop layout: header items aligned on a single row without wrapping.

---

#### Group 8 · Header Layout, Avatar, Premium Purchase Page (`a090244`, `3d55c80`, `ad6aaf2`, `c0aa5e9`)

**`a090244` — Fix header layout + user avatar + clean up duplicate CSS**
- Header reorganised into a two-zone flex layout: logo left, nav+auth right.
- User avatar (coloured circle with first letter of username) added and shown after sign-in.
- Large block of duplicate CSS rules for the auth section removed.

**`3d55c80` — Premium button simplification + `premium.html` purchase page**
- The floating premium button in the header simplified to a single pill-shaped button.
- `public/premium.html` created as a dedicated purchase page with a 3-step flow:
  1. Plan selection (monthly $3 / yearly $20)
  2. Username + password creation
  3. Payment confirmation (Stripe integration placeholder)
- Header and auth CSS restructured to support both the main app and the new premium page.

**`ad6aaf2` — Fix CSS breaks, header layout, missing classes**
- Several CSS class names referenced in HTML but not defined in `styles.css` were added.
- Header layout corrected after the premium button simplification broke the alignment.

**`c0aa5e9` — Fix admin page + premium dashboard + auth status bar + KV namespace fixes**
- Admin page (`public/admin.html`) user list was showing raw KV keys instead of usernames — fixed to display `displayUsername`.
- Premium dashboard wired up: sign-in state check on load, dashboard shown/hidden based on `isPremium`.
- Auth status bar (top of page) shows signed-in username and plan badge.
- Logout button added to the status bar.
- `API_KEYS` KV namespace binding corrected — was incorrectly referencing `TEMP_EMAILS`.

---

## [0.3.0] — 2026-03-06

### Phantom Mail Rebrand + Complete Auth System Overhaul

This release renames the project from "TempMail" to "Phantom Mail", redesigns the logo, and completely replaces the OTP-based authentication with a username/password system backed by Cloudflare KV sessions.

---

#### Group 1 · Rebrand (`65d1184`, `62f9cc3`, `a87e58b`)

**`65d1184` — Rebrand TempMail → Phantom Mail + performance optimizations**
- Every occurrence of "TempMail" in `index.html`, `app.js`, `styles.css`, `email-handler/worker.js`, `generate.js`, and `emails.js` replaced with "Phantom Mail".
- `README.md` updated with new name and tagline.
- Several synchronous DOM operations converted to be deferred, reducing initial paint time.

**`62f9cc3` — Logo styling: Phantom MAIL**
- Logo text changed to title-case "Phantom" + all-caps green "MAIL" using a `<span>` with `color: #00d09c`.

**`a87e58b` — Revert mobile inbox to match desktop layout**
- A previous commit had changed the mobile inbox to a stacked card layout that looked different from desktop. Reverted so both desktop and mobile use the same table-row structure, just with adjusted column widths.

---

#### Group 2 · Auth System Overhaul (`2d09592`, `4e0ec98`, `b6b4c54`, `a384168`)

**`2d09592` — Replace OTP with username/password + admin dashboard**

The original authentication used a 6-digit OTP sent via SendGrid (`functions/api/auth/send-otp.js` + `verify-otp.js`). This was replaced entirely:

- **Deleted:** `send-otp.js`, `verify-otp.js`, SendGrid dependency, `OTP_STORE` KV binding.
- **Added:** `functions/api/auth/signup.js` — creates a user record in `env.EMAILS` under `user:{username}` with hashed password, `isPremium: false`, `createdAt` timestamp.
- **Added:** `functions/api/auth/signin.js` — validates credentials, creates a `session:{token}` KV record with 30-day TTL. Returns `{token, username, isPremium}` JSON.
- **Added:** `public/admin.html` — admin-only dashboard listing all users, their premium status, and expiry dates. Protected by `admin_session:{token}` KV lookup.
- **Added:** `functions/api/admin/[[action]].js` — admin API routes: list users, grant/revoke premium, set expiry.
- `public/app.js` — replaced OTP UI flow with username/password sign-in form.
- `public/index.html` — sign-in modal updated with username + password fields.

**`4e0ec98` — Complete premium flow overhaul with dynamic 3-step UI**
- `premium.html` now has a multi-step purchase wizard: step 1 (plan), step 2 (account creation), step 3 (success/confirm). Steps shown/hidden dynamically via JS without page reloads.
- Plan selection stores the chosen plan in `localStorage` so it persists across the wizard.
- Account creation form calls `POST /api/auth/signup` and `POST /api/auth/signin` in sequence.

**`b6b4c54` — Handle empty emails gracefully + style premium flow**
- `signin.js` and `signup.js` were crashing if the KV `list()` returned zero items. Added empty-array guard.
- Premium flow step transitions animated with CSS `opacity` + `transform: translateY`.

**`a384168` — Glassmorphism premium modal redesign + KV binding fix**
- Premium upgrade modal redesigned with `backdrop-filter: blur(16px)`, dark semi-transparent background, and animated entrance.
- `API_KEYS` KV namespace binding corrected in `wrangler.toml` — it was pointing to the wrong namespace ID.

---

## [0.2.0] — 2026-01-23 to 2026-01-27

### Core Feature Build-out: Premium APIs, QR, Sender Detection, Mobile Polish

This period covers the intense day-by-day iteration that built all the core features on top of the initial skeleton — QR codes, notifications, the developer API, email forwarding, saved addresses, and dozens of mobile UI refinements.

---

#### Group 1 · First Premium Features (`9684386`, `42d5e11`)

**`9684386` — Add premium features: QR, notifications, auth, forwarding, developer API, saved emails**

This is the largest single commit in the project's history. Added **11 files**:

- **`functions/api/auth/send-otp.js`** *(original auth, later replaced)* — sends a 6-digit OTP via SendGrid to the user's email address; stores OTP in `OTP_STORE` KV with 10-minute TTL.
- **`functions/api/auth/verify-otp.js`** — validates the OTP, creates a session token, stores in KV.
- **`functions/api/user/api-key.js`** — `GET` returns (or generates) an API key for the user; `POST` regenerates. Stored in `EMAILS` KV under `apikey:{username}`. Rate limits: 100/day (free), 10,000/day (premium).
- **`functions/api/user/forwarding.js`** — `GET/POST/DELETE` for email forwarding rules. Stored in `EMAILS` KV under `forward:{address}`. Premium-only.
- **`functions/api/user/saved-emails.js`** — `GET/POST/DELETE` for permanent email address management. Up to 8 per premium account. Stored as `user:{username}` record `savedEmails` array + standalone `{address}` KV entry.
- **`functions/api/v1/emails.js`** — public developer API endpoint: `GET /api/v1/emails?address=...` requires `X-API-Key` header, enforces per-key daily rate limit.
- **`functions/api/v1/generate.js`** — public developer API endpoint: `POST /api/v1/generate` generates a new temp email address; requires `X-API-Key`, enforces daily limit.
- `email-handler/worker.js` updated to store emails in KV for the API endpoints to read.
- `public/app.js` — premium dashboard UI, sign-in modal, notification permission request, QR code display.
- `public/index.html` — sign-in button, premium dashboard section, notification toggle.
- `public/styles.css` — premium dashboard styles, sign-in modal, QR dropdown.

**`42d5e11` — Add QR code, Notifications, Coffee link**
- QR code button added to the main toolbar — generates a QR for the current email address using an inline `<canvas>` via the `qrcode-generator` JS library.
- Browser notification permission request added: if granted, a notification fires when new email arrives.
- Buy Me a Coffee link added to the footer.

---

#### Group 2 · QR Code Iteration (`026c9e9`, `91478e4`, `3a07453`, `a73f0aa`, `deb8792`)

**`026c9e9` — Switch to qrcode-generator library**
- The initial QR implementation used a library that didn't work in browser contexts (no `window.qrcode` global).
- Replaced with `qrcode-generator` v1.4.4 loaded via CDN — confirmed to work in both browser and Worker.

**`91478e4` — Fix QR button position + swap footer buttons + fix header**
- QR button moved to be inline with the email input field rather than floating separately.
- Footer buttons (Copy, QR) swapped to a more natural left-to-right order.
- Header alignment corrected after the new button caused a layout shift.

**`3a07453` — Copy button outside input, QR larger inside input**
- Copy button extracted from inside the input group and placed next to it.
- QR button made larger within the input row for easier tapping.

**`a73f0aa` — QR dropdown popup, premium button pulse animation, input width fix**
- QR code now appears in a dropdown popup below the button instead of replacing the page.
- Premium button gets a subtle CSS `pulse` animation (scale 1.0 → 1.03) to draw attention.
- Email input box width reduced to prevent layout overflow on narrow screens.
- Hover effects added to all toolbar buttons.

**`deb8792` — Fix mobile QR: separate dropdown positioned above button**
- On mobile, the QR dropdown was appearing below the viewport edge.
- Separate mobile QR dropdown created with `position: absolute; bottom: 100%` to appear above the button.

---

#### Group 3 · QR Backend + Sender Detection (`87fb250`, `bd4b985`, `f3702f3`, `0a2c055`, `7a409e4`)

**`87fb250` — Fix QR API: always return JSON base64**
- `GET /api/qr?email=...` was returning a redirect to QRServer.com on some code paths and a JSON response on others.
- Standardised: always fetches the PNG from QRServer.com, converts to base64, and returns `{ qr: "data:image/png;base64,..." }` JSON. No redirects.

**`bd4b985` — Backend QR API: use QRServer.com, no borders, smaller mobile dropdown**
- Migrated from the client-side canvas QR generator to a backend call to `https://api.qrserver.com` — eliminates the need for a JS library entirely.
- QR image served without a white border (`margin=10` only), cleaner appearance.
- Mobile QR dropdown width reduced.

**`f3702f3` — Make QR code denser**
- QR error correction level set to type 10 (high density) for better scan reliability.
- Cell size reduced so the QR fits in a smaller popup.

**`0a2c055` — Redesign QR dropdown: arrow pointer, centered, clean style**
- QR dropdown styled with a CSS `::before` pseudo-element triangle pointer.
- Dropdown centered below the QR button.
- White background, rounded corners, drop shadow.

**`7a409e4` — Fix sender detection: domain-first priority, 50+ services**
- The sender-parsing function that maps email addresses to friendly names (e.g. `no-reply@github.com` → `GitHub`) was rewritten.
- Priority order: exact domain match → subdomain match → keyword in local-part.
- Dictionary expanded to 50+ services: Google, GitHub, Twitter/X, Netflix, Amazon, PayPal, Stripe, Notion, Figma, Vercel, Cloudflare, Discord, Slack, YouTube, LinkedIn, Instagram, WhatsApp, Telegram, and many more.
- Tracking link patterns (`click.`, `email.`, `mail.`) now excluded from the domain lookup to avoid misidentifying marketing systems as the true sender.

---

#### Group 4 · localStorage Persistence + Inbox Polish (`a0334f6`, `e0b36c0`, `e9acd97`, `7e00518`)

**`a0334f6` — Fix: persistent read/deleted email state using localStorage**
- Read emails and deleted emails were tracked in memory only — a page reload would show all emails as unread and show deleted emails again.
- `readIds` and `deletedIds` arrays now saved to `localStorage` on every change and loaded on startup.
- Unread count badge in the tab title now persists correctly across sessions.

**`e0b36c0` — Fix sender parsing Netflix/UUID, clean UTF-8, localStorage persistence**
- Netflix uses `mailer@m.netflix.com` — added to the domain map.
- UUID-style local parts (from tracking systems) now display as "Unknown Sender" instead of the raw UUID.
- `localStorage.setItem` calls refactored into a single `saveState()` helper to avoid scattered write calls.
- UTF-8 BOM stripped from email subject lines before display (early version; later improved in v1.2.0).

**`e9acd97` — Enhanced inbox list with sender name+email, improved email viewer**
- Inbox row now shows both the parsed sender name AND the email address below it (two-line layout).
- Email viewer modal header redesigned with a dark background, white subject text, and sender info row.
- "Loading…" animation shown while the email body is being fetched/parsed.

**`7e00518` — UI polish: styled logo, taller inbox, loading icon**
- Logo font changed to a bold sans-serif with letter-spacing.
- Inbox list minimum height increased so it doesn't appear tiny when empty.
- Loading spinner replaced with an animated envelope + arrows icon.

---

#### Group 5 · Layout & Loading Animation (`7c83c7e`, `c986901`, `d422fda`, `6df45a4`, `a653bae`)

**`7c83c7e` — Add About modal, footer with contact links, loading animation fix**
- "About" button added to the header — opens a modal describing the service, privacy model, and contact links.
- Footer added with GitHub, Telegram, and Buy Me a Coffee links.
- Loading animation: CSS `@keyframes rotate` applied to two arrow elements on either side of an envelope icon.

**`c986901` — Two-arrow loading animation, reduced quote-inbox gap**
- Loading animation refined to show two arrows (↺ ↻) rotating around the envelope.
- Vertical gap between the tagline and the inbox reduced — the page looks more compact.

**`d422fda` — Black inbox header, centered SUBJECT, rotating arrows, compact quote**
- Inbox header row (with column labels SENDER / SUBJECT / TIME) given a black background.
- SUBJECT column label centered.
- Rotating arrow animation smoothed out (easing changed from `linear` to `ease-in-out`).
- Quote section below inbox made smaller (font-size reduced).

**`6df45a4` — Fix loading arrows, center SUBJECT, dark blue header, larger icons**
- Arrow animation corrected — arrows were misaligned relative to the envelope.
- SUBJECT header centered using `text-align: center`.
- Inbox header background changed from black to dark blue (`#0a0a1a`) to match the page theme.
- Toolbar icon sizes increased for easier tapping on mobile.

**`a653bae` — Fix layout: centred logo, About corner, quote after inbox, compact footer**
- Logo centered on desktop with `text-align: center`.
- "About" button repositioned to the top-right corner.
- Quote section moved to below the inbox (previously it was above).
- Footer compacted — reduced padding and font-size.

---

#### Group 6 · Desktop vs Mobile Layout Optimisation (`3804c1c`, `59e83f7`, `6def8ca`, `3db97db`, `5bb0f85`)

**`3804c1c` — Desktop side-by-side, mobile stacked with big Copy button**
- On desktop (>768px): inbox and email viewer displayed side-by-side using CSS Grid (`grid-template-columns: 1fr 1fr`).
- On mobile: stacked vertically, with a large full-width "Copy" button for easy one-tap copy.

**`59e83f7` — Reduce spacing, compact layout**
- Reduced `padding` and `margin` throughout to give the app a more compact, app-like feel rather than a document-like layout.

**`6def8ca` — Polish: inbox blue background, thin loading arrows, 13px mobile input, rotation fix**
- Inbox list background set to a subtle dark blue.
- Loading arrows made thinner (border-width reduced).
- Email input font-size set to 13px on mobile to prevent iOS auto-zoom on focus.
- CSS rotation animation direction corrected (was going the wrong way for one arrow).

**`3db97db` — Reduce vertical gap between tagline and inbox by 50%**
- The large whitespace gap between the hero tagline and the inbox was halved using `margin-top` reduction.

**`5bb0f85` — Optimise desktop email body font size to prevent scrolling**
- Email body text was too large on desktop, causing the viewer to scroll vertically for short emails.
- `font-size` in the email viewer reduced from 16px to 14px for desktop breakpoint.

---

#### Group 7 · PC UI Polish & AdSense (`910de70`, `dbc5c0e`, `8eb5931`, `ae73550`, `f3b4a6f`, `4a9a98d`)

**`910de70` — PC UI polish: left-aligned input, restored Copy text**
- Email input and toolbar buttons left-aligned on desktop for a cleaner look.
- Copy button had its "Copy" text label restored (was icon-only after a previous refactor).

**`dbc5c0e` — Finalise inbox header colour to neutral dark gray**
- After several iterations (black → dark blue → various), inbox header settled on `#1a1a2e` (neutral dark gray-blue).

**`8eb5931` — Reduce email input horizontal length to ~480px**
- Email input was stretching full-width on desktop, looking awkward on wide monitors.
- `max-width: 480px` applied.

**`ae73550` + `f3b4a6f` — Reduce / increase textbox height**
- Two iterative commits adjusting the email input field height: first reduced (too tall), then slightly increased back (too short). Settled at 44px.

**`4a9a98d` — Add Google AdSense script**
- Google AdSense async script tag added to `<head>` of `index.html` with `data-ad-client` attribute.

---

#### Group 8 · Loading Animation Iteration (`0ffd984`, `985f941`, `a4c48ff`)

**`0ffd984` — Update loading animation: static envelope + rotating arrows**
- Loading indicator changed from a spinner to a static envelope icon with two rotating arrows on either side — representing "waiting for email".

**`985f941` — Refine loading animation: darker colours, longer arrows, centred envelope**
- Arrow colours darkened for better contrast on the dark background.
- Arrow SVG paths lengthened.
- Envelope centred between the arrows.

**`a4c48ff` — Revert loading animation to lighter style**
- User found the dark animation too heavy. Reverted arrow colour to a lighter `#00d09c` green.

---

#### Group 9 · Mobile Inbox Refinements (`e96c84f`, `686b635`, `4482c4a`, `30585e4`, `78a8451`, `b7fba31`, `ac46ba3`, `ee34466`, `d3aab49`)

These commits represent rapid day-by-day iteration on mobile inbox display:

**`e96c84f` — Mobile inbox: stacked layout, INBOX header centred**
- On mobile, inbox rows stacked vertically instead of cramped columns.
- "INBOX" label centred in the header bar.

**`686b635` — Show sender email in green, vertically centre subject**
- Sender email address shown in `#00d09c` green below the sender name.
- Subject text vertically centred within the row height.

**`4482c4a` — Left-align subject text**
- Subject column switched from `text-align: center` to `text-align: left` to match the SUBJECT column header.

**`30585e4` — Centre subject text horizontally and vertically**
- Reverted left-align decision — centred both horizontally and vertically.

**`78a8451` — Align subject text left to match header**
- Final decision: left-aligned, matching the header column.

**`b7fba31` — Enhance mobile inbox UI: left align, taller header**
- Inbox rows left-aligned for easier reading.
- Header row made taller (44px) for easier touch targets.

**`ac46ba3` — Fix mobile inbox header: visible INBOX text**
- "INBOX" text was invisible (white text on white background) on some mobile browsers. Colour explicitly set.

**`ee34466` — Fix mobile layout: centre header, increase height, align subject**
- Mobile header centred, height increased, subject text alignment corrected to match all the above decisions.

**`d3aab49` — Increase mobile UI sizes: logo, text, premium button, email display**
- Logo font-size increased on mobile for readability.
- Email display area font-size increased.
- Premium button made larger and easier to tap.

---

#### Group 10 · Mobile Layout & QR Fixes (`ee5262c`, `ec24b06`, `89abf33`, `f775dfd`)

**`ee5262c` — Fix mobile layout: hide About+QR+Copy button text, pill premium button**
- On mobile, the "About", "QR", and "Copy" buttons show icons only (no text) to save horizontal space.
- Premium button changed to a pill shape (`border-radius: 999px`).
- Header no longer wraps to a second line on narrow screens.

**`ec24b06` — Fix About button positioning**
- About button was using `position: absolute` which caused it to overlap other elements in some layout states.
- Changed to a flex item within the header container.

**`89abf33` — Fix mobile email text: smaller font, word-break, centred**
- Email address display inside the inbox viewer has `word-break: break-all` so long addresses don't overflow.
- Font size reduced on mobile to fit within the container.

**`f775dfd` — Update Buy Me a Coffee link**
- Buy Me a Coffee URL updated to the correct profile page (`https://buymeacoffee.com/unknownlll2829`).

---

## [0.1.0] — 2026-01-22

### Initial Release

---

#### Group 1 · First Commit & Early UI Iterations (`d14a006`, `6872d07`, `4d3001c`, `1263140`, `84d393a`, `1c9be2f`, `605175a`)

**`d14a006` — Initial commit: Temp Mail web app for Cloudflare Pages**

The very first commit. Established the project structure:
- `public/index.html` — basic single-page app skeleton with an email display area and inbox.
- `public/app.js` — `generateEmail()` calling `POST /api/generate`; `fetchEmails()` polling `GET /api/emails`; basic email list render.
- `functions/api/generate.js` — generates a random `{word}{word}{number}@unknownlll2829.qzz.io` email address; stores it in `TEMP_EMAILS` KV with 1-hour TTL.
- `functions/api/emails.js` — reads from `TEMP_EMAILS` KV and returns all emails for a given address as JSON.

**`6872d07` — Simple clean UI like temp-mail.io**
- UI redesigned to match the clean aesthetic of temp-mail.io as a reference: white card on light background, minimal toolbar.

**`4d3001c` — UI update: blue background, centered logo, quotes, regenerate button, features**
- Background changed to dark navy blue (`#0a0a1a`).
- Logo centred at the top.
- Inspirational quote section added below the inbox.
- "Regenerate" button added to get a new email address.
- Feature highlights section added at the bottom of the page.

**`1263140` — Enhanced inbox, better sender parsing, full mobile optimisation**
- Inbox rows now show sender name (parsed from `From:` header), subject, and timestamp.
- Basic sender name parsing: strips angle-bracket addresses, extracts display name.
- First mobile media query: stacked layout, touch-friendly button sizes.

**`84d393a` — Quote and feature cards at bottom**
- Quote and feature sections moved to below the inbox.
- Feature cards styled as small dark glass cards.

**`1c9be2f` — Full dark blue theme, quote below buttons, features dark theme**
- Entire app given a consistent dark blue + green (`#00d09c`) colour palette.
- Quote section below the action buttons.
- Feature cards updated to dark theme.

**`605175a` — Premium UI: dark/light theme, human-like emails, attachments, quotes**
- `email-handler/worker.js` added — Cloudflare Email Routing worker that receives incoming emails, parses MIME, and stores them in `TEMP_EMAILS` KV.
- `functions/api/generate.js` upgraded — email addresses now use human-like name patterns (`firstname.lastname@...`) instead of random words.
- `public/styles.css` created as a separate file (extracted from inline `<style>`).
- Attachment metadata parsing added (filename, content-type) — stored in KV but not yet displayed.
- Dark/light theme toggle added (later removed for the permanent dark theme).

---

## Links

- **Live Demo:** https://mail.unknowns.app
- **GitHub:** https://github.com/Unknown-2829/Phantom-mail
- **API Docs:** https://mail.unknowns.app/api-docs.html
- **Telegram:** https://t.me/unknownlll2829
- **Support:** https://buymeacoffee.com/unknownlll2829

---

[1.3.0]: https://github.com/Unknown-2829/Phantom-mail/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/Unknown-2829/Phantom-mail/releases/tag/v1.1.0
[1.1.0]: https://github.com/Unknown-2829/Phantom-mail/releases/tag/v1.1.0
[1.0.0]: https://github.com/Unknown-2829/Phantom-mail/releases/tag/v1.0.0
