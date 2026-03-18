# Changelog

All notable changes to Phantom Mail will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
