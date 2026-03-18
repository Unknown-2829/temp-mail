# GitHub Release v1.0.0 Instructions

Since the `gh` CLI is restricted, please create the release manually via GitHub UI:

## Steps to Create Release v1.0.0

1. **Navigate to GitHub**:
   - Go to https://github.com/Unknown-2829/Phantom-mail/releases/new

2. **Tag Details**:
   - Tag version: `v1.0.0`
   - Target: `main` (or merge this PR first, then target `main`)

3. **Release Title**: `v1.0.0 - Legal Compliance & Marketing Update 🎉`

4. **Release Description** (copy the content below):

---

## 🎉 Major Release - Legal Compliance & Marketing Update

This release adds comprehensive legal documentation, highlights the 30-day email retention feature for Premium users, and completely rewrites the README with deploy buttons, comparison tables, and enhanced documentation.

### ✨ What's New

#### Legal & Compliance 📜
- **Privacy Policy** - Transparent data collection and retention policies
- **Terms of Service** - Clear service terms, prohibited activities, and liability limitations
- **Acceptable Use Policy** - Guidelines on legitimate vs prohibited uses
- Footer links to all legal pages

#### Premium Feature Highlights 🌟
- **30-Day Email Retention** now prominently displayed:
  - Featured in premium modal on homepage
  - Comparison line on hero section
  - Updated pricing cards with 6 features (was 4)
  - New comparison table row showing 1 hour (free) vs 30 days (premium)

#### Documentation 📚
- **Complete README rewrite** with:
  - Badges (License, Live Demo, Cloudflare, GitHub Stars)
  - One-click Deploy to Cloudflare Pages button
  - Feature comparison table (Phantom Mail vs Competitors)
  - Visual architecture diagram
  - Placeholder screenshots
  - Comprehensive 8-step setup guide
  - Developer API docs with curl examples
  - Star History chart

### 📦 Full Changelog

See [CHANGELOG.md](https://github.com/Unknown-2829/Phantom-mail/blob/main/CHANGELOG.md) for complete details including all 143+ commits from initial development to v1.0.0.

### 🚀 Deployment

Deploy your own instance:

[![Deploy to Cloudflare Pages](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Unknown-2829/Phantom-mail)

Or follow the [setup guide](https://github.com/Unknown-2829/Phantom-mail#-cloudflare-setup-guide).

### 🔗 Links

- **Live Demo**: https://mail.unknowns.app
- **Privacy Policy**: https://mail.unknowns.app/privacy-policy.html
- **Terms of Service**: https://mail.unknowns.app/terms.html
- **Acceptable Use**: https://mail.unknowns.app/acceptable-use.html
- **API Docs**: https://mail.unknowns.app/api-docs.html

### 💬 Support

- 📩 **Telegram**: [@unknownlll2829](https://t.me/unknownlll2829)
- 🐛 **Issues**: [GitHub Issues](https://github.com/Unknown-2829/Phantom-mail/issues)
- ☕ **Buy me a Coffee**: [buymeacoffee.com/unknownlll2829](https://buymeacoffee.com/unknownlll2829)

### ⚠️ Migration Notes

- **For Users**: No breaking changes. All existing accounts and emails remain intact.
- **For Self-Hosters**: No infrastructure changes required. Legal pages automatically available.
- **For Developers**: No API changes. Rate limits unchanged.

### 🙏 Credits

- **Developer**: Unknown-2829
- **Infrastructure**: Cloudflare Pages, Workers, KV, Email Routing
- **License**: MIT

---

**Full Changelog**: https://github.com/Unknown-2829/Phantom-mail/compare/e7d895c...v1.0.0

---

5. **Mark as Latest Release**: ✅ Check this box

6. **Click "Publish release"**

## Alternative: Create via Git Tag

If you prefer using git:

```bash
# Create and push tag
git tag -a v1.0.0 -m "v1.0.0 - Legal Compliance & Marketing Update"
git push origin v1.0.0

# Then create release from tag in GitHub UI
```
