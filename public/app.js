/* Phantom Mail - JavaScript (Optimized) */

/* ===== Cached DOM References ===== */
let $inboxBody, $emailDisplay, $toast, $toastMsg;

let currentEmail = '';
let emailsList = [];
let autoRefreshInterval = null;
let currentViewIndex = -1;
const originalTitle = document.title;

// Reusable SVG markup for the Sign-In account icon button
const SIGN_IN_BTN_HTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="flex-shrink:0"><title>Account icon</title><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg> Sign In';

// Reusable SVG markup for the logged-in Account button
const ACCOUNT_BTN_HTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="flex-shrink:0"><title>Account icon</title><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg> Account';

// Domain used for permanent / custom email addresses
const PERM_EMAIL_DOMAIN = '@unknownlll2829.qzz.io';
// Allowed characters for permanent email usernames
const PERM_USERNAME_RE = /^[a-z0-9._-]+$/;

// Persistent state (loaded once at startup)
let deletedIds = JSON.parse(localStorage.getItem('deletedIds') || '[]');
let readIds = JSON.parse(localStorage.getItem('readIds') || '[]');

// Flags to prevent double-actions
let isGenerating = false;
let renderPending = false;

// ResizeObserver used to keep the email iframe height in sync with its content.
// Stored here so closeModal() can disconnect it and prevent memory leaks.
let _iframeResizeObserver = null;

// Regex constants reused during HTML email pre-processing
const _NUMERIC_ATTR_RE = /^\d+$/;          // matches bare integer attribute values like "600"
const _PIXEL_STYLE_RE  = /^\d+(\.\d+)?px$/i; // matches inline pixel values like "600px", "12.5px"

// Initialize
document.addEventListener('DOMContentLoaded', init);

function init() {
  // Cache DOM references once
  $inboxBody = document.getElementById('inbox-body');
  $emailDisplay = document.getElementById('email-display');
  $toast = document.getElementById('toast');
  $toastMsg = document.getElementById('toast-message');

  requestNotificationPermission();

  const saved = localStorage.getItem('tempEmail');
  const savedTime = localStorage.getItem('emailCreatedAt');

  if (saved && savedTime && (Date.now() - parseInt(savedTime)) < 3600000) {
    currentEmail = saved;
    $emailDisplay.value = currentEmail;
    startAutoRefresh();
    refreshEmails();
  } else {
    localStorage.removeItem('tempEmail');
    localStorage.removeItem('emailCreatedAt');
    generateEmail();
  }
}

// ===== Notification Permission =====
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function showNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body,
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📬</text></svg>'
    });
  }
}

// ===== Tab Title =====
function updateTabTitle(newCount) {
  document.title = newCount > 0 ? `(${newCount}) ${originalTitle}` : originalTitle;
}

// ===== Generate Email =====
async function generateEmail() {
  if (isGenerating) return;
  isGenerating = true;

  $emailDisplay.value = 'Loading...';
  $emailDisplay.style.opacity = '0.6';

  await new Promise(r => setTimeout(r, 800));

  try {
    const response = await fetch('/api/generate', { method: 'POST' });
    if (!response.ok) throw new Error('Failed');

    const data = await response.json();
    currentEmail = data.email;

    $emailDisplay.value = currentEmail;
    $emailDisplay.style.opacity = '1';

    localStorage.setItem('tempEmail', currentEmail);
    localStorage.setItem('emailCreatedAt', Date.now().toString());

    startAutoRefresh();
    showToast('✨ Email ready!');
  } catch (e) {
    $emailDisplay.value = 'Error - Tap Regenerate';
    $emailDisplay.style.opacity = '1';
    showToast('❌ Error');
  } finally {
    isGenerating = false;
  }
}

// ===== Regenerate (debounced) =====
let regenTimeout = null;
function regenerateEmail() {
  if (regenTimeout) return;
  regenTimeout = setTimeout(() => { regenTimeout = null; }, 1500);

  stopAutoRefresh();
  emailsList = [];

  localStorage.removeItem('tempEmail');
  localStorage.removeItem('emailCreatedAt');
  localStorage.removeItem('deletedIds');
  localStorage.removeItem('readIds');
  deletedIds = [];
  readIds = [];

  scheduleRender();
  generateEmail();
}

// ===== Delete Email =====
function deleteEmail() {
  stopAutoRefresh();
  currentEmail = '';
  emailsList = [];

  localStorage.removeItem('tempEmail');
  localStorage.removeItem('emailCreatedAt');
  localStorage.removeItem('deletedIds');
  localStorage.removeItem('readIds');
  deletedIds = [];
  readIds = [];

  $emailDisplay.value = '';
  scheduleRender();
  updateTabTitle(0);
  showToast('🗑️ Deleted');
  setTimeout(generateEmail, 400);
}

// ===== Copy Email =====
function copyEmail() {
  if (!currentEmail) return;
  // Show feedback immediately (optimistic)
  showToast('📋 Copied!');
  navigator.clipboard.writeText(currentEmail).catch(() => {
    $emailDisplay.select();
    document.execCommand('copy');
  });
}

// ===== Refresh Emails =====
let _refreshErrorCount = 0;

async function refreshEmails() {
  if (!currentEmail) return;

  try {
    const since = emailsList.length > 0 ? emailsList.reduce((max, e) => Math.max(max, e.timestamp || 0), 0) : 0;
    const url = `/api/emails?address=${encodeURIComponent(currentEmail)}${since ? `&since=${since}` : ''}`;
    const response = await fetch(url);
    const data = await response.json();

    _refreshErrorCount = 0; // Reset on success

    const rawEmails = data.emails || [];
    // When using since= we get only new emails — merge with existing list
    let merged;
    if (since > 0 && rawEmails.length > 0) {
      const existingKeys = new Set(emailsList.map(e => e._key || e.timestamp));
      const newOnly = rawEmails.filter(e => !existingKeys.has(e._key || e.timestamp));
      merged = [...newOnly, ...emailsList];
    } else if (since > 0) {
      merged = emailsList; // nothing new
    } else {
      merged = rawEmails;
    }

    const validEmails = merged.filter(e => !deletedIds.includes(e._key || e.id || e.timestamp));

    validEmails.forEach(e => {
      if (readIds.includes(e._key || e.id || e.timestamp)) e.read = true;
    });

    const oldCount = emailsList.length;
    emailsList = validEmails;
    const newCount = emailsList.length;

    if (newCount > oldCount && oldCount > 0) {
      const diff = newCount - oldCount;
      showToast(`📧 ${diff} new!`);
      showNotification('New Email!', `You have ${diff} new email(s)`);
    }

    const unreadCount = emailsList.filter(e => !e.read).length;
    updateTabTitle(unreadCount);

    scheduleRender();
  } catch (e) {
    _refreshErrorCount++;
    console.error('Refresh error #' + _refreshErrorCount, e);
    // Back off: 5s → 10s → 20s → 60s cap
    if (_refreshErrorCount > 1) {
      stopAutoRefresh();
      const delay = Math.min(5000 * Math.pow(2, _refreshErrorCount - 1), 60000);
      const backoffTimer = setTimeout(() => {
        // Restart normal interval then fire immediately
        startAutoRefresh();
        refreshEmails();
      }, delay);
      autoRefreshInterval = backoffTimer; // Track so stopAutoRefresh() can cancel it
    }
  }
}

// ===== Schedule Render (RAF-batched) =====
function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    renderInbox();
  });
}

// ===== Render Inbox =====
function renderInbox() {
  if (!$inboxBody) return;

  if (emailsList.length === 0) {
    $inboxBody.innerHTML = `
      <div class="empty-inbox">
        <div class="loading-animation">
          <svg class="loading-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <g class="arrows-ring">
               <path d="M50 10 A 40 40 0 0 1 85 30 L 90 25 L 90 40 L 75 40 L 80 35 A 35 35 0 0 0 50 15 Z" />
               <path d="M50 90 A 40 40 0 0 1 15 70 L 10 75 L 10 60 L 25 60 L 20 65 A 35 35 0 0 0 50 85 Z" />
            </g>
            <g class="envelope-icon" transform="translate(28, 35) scale(0.45)">
                <path d="M10,80 L90,80 L90,40 L50,65 L10,40 Z" fill="#D1D4DE"/>
                <path d="M10,30 L50,55 L90,30 L50,5 Z" fill="#9FA3B5"/>
                <rect x="10" y="30" width="80" height="50" rx="5" fill-opacity="0.2"/>
            </g>
          </svg>
        </div>
        <p class="empty-title">Your inbox is empty</p>
        <p class="empty-subtitle">Waiting for incoming emails</p>
      </div>
    `;
    return;
  }

  // Build rows as a single HTML string (fast)
  const rows = emailsList.map((email, i) => {
    const sender = parseSender(email.from, email);
    const subject = email.subject || '(No Subject)';
    return `
      <div class="email-row ${email.read ? '' : 'unread'}" onclick="viewEmail(${i})">
        <div class="email-sender">
          <span class="sender-name">${escapeHtml(sender.name)}</span>
          <span class="sender-email-small">${escapeHtml(sender.email)}</span>
        </div>
        <div class="email-subject">${escapeHtml(subject)}</div>
        <div class="email-view"><span class="view-arrow">›</span></div>
      </div>
    `;
  }).join('');

  $inboxBody.innerHTML = rows;
}

// ===== Parse Sender =====
function parseSender(from, emailObj) {
  if (!from) return { name: 'Unknown', email: '' };

  // If email object has stored RFC headers, prefer those (set by CHANGE 15 / worker fix)
  if (emailObj?.headers?.from) {
    from = emailObj.headers.from;
  }

  // Decode SES/SendGrid bounce routing: bounces+TOKEN-ORIG=domain@bounce.host
  // The original sender is encoded as: localpart=originaldomain inside the bounce local part
  const bounceMatch = from.match(/bounces\+[^@]*?[=+]([a-zA-Z0-9._%-]+=[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})@/i);
  if (bounceMatch) {
    // bounceMatch[1] is like "alert=uptimerobot.com" → decode to "alert@uptimerobot.com"
    const recovered = bounceMatch[1].replace(/=([^=]+)$/, '@$1');
    from = recovered;
  }

  let emailAddr = from;
  let name = '';

  let match = from.match(/^"?([^"<]+)"?\s*<([^>]+)>/);
  if (match) {
    name = match[1].trim();
    emailAddr = match[2].trim();
  } else {
    match = from.match(/<?([\^@<\s]+@[^>\s]+)>?/);
    if (match) emailAddr = match[1];
  }

  const domainName = detectFromDomain(emailAddr);
  if (domainName) return { name: domainName, email: emailAddr };

  if (name && !looksLikeUUID(name) && name.length > 2) return { name, email: emailAddr };

  const contentName = detectFromSubject(emailObj);
  if (contentName) return { name: contentName, email: emailAddr };

  return { name: extractFromDomain(emailAddr), email: emailAddr };
}

function looksLikeUUID(str) {
  if (!str) return false;
  const cleaned = str.replace(/[-_\s]/g, '');
  if (/^[0-9a-f]{16,}$/i.test(cleaned)) return true;
  if (str.length > 20 && /^[0-9a-zA-Z-_]+$/.test(str)) return true;
  return false;
}

const KNOWN_SERVICES = {
  'render.com': 'Render', 'vercel.com': 'Vercel', 'netlify.com': 'Netlify',
  'heroku.com': 'Heroku', 'github.com': 'GitHub', 'gitlab.com': 'GitLab',
  'bitbucket.org': 'Bitbucket', 'cloudflare.com': 'Cloudflare',
  'digitalocean.com': 'DigitalOcean', 'railway.app': 'Railway',
  'facebook.com': 'Facebook', 'fb.com': 'Facebook', 'instagram.com': 'Instagram',
  'twitter.com': 'Twitter', 'x.com': 'X', 'linkedin.com': 'LinkedIn',
  'tiktok.com': 'TikTok', 'pinterest.com': 'Pinterest', 'reddit.com': 'Reddit',
  'discord.com': 'Discord', 'discordapp.com': 'Discord', 'telegram.org': 'Telegram',
  'whatsapp.com': 'WhatsApp', 'google.com': 'Google', 'microsoft.com': 'Microsoft',
  'apple.com': 'Apple', 'amazon.com': 'Amazon', 'netflix.com': 'Netflix',
  'spotify.com': 'Spotify', 'adobe.com': 'Adobe', 'zoom.us': 'Zoom',
  'dropbox.com': 'Dropbox', 'slack.com': 'Slack', 'notion.so': 'Notion',
  'figma.com': 'Figma', 'canva.com': 'Canva', 'paypal.com': 'PayPal',
  'stripe.com': 'Stripe', 'razorpay.com': 'Razorpay', 'steam': 'Steam',
  'epicgames.com': 'Epic Games', 'roblox.com': 'Roblox', 'ebay.com': 'eBay',
  'flipkart.com': 'Flipkart', 'myntra.com': 'Myntra', 'uber.com': 'Uber',
  'lyft.com': 'Lyft', 'airbnb.com': 'Airbnb', 'booking.com': 'Booking.com',
  'zomato.com': 'Zomato', 'swiggy.com': 'Swiggy',
};

// Pre-build entries array once for faster lookups
const KNOWN_ENTRIES = Object.entries(KNOWN_SERVICES);

function detectFromDomain(emailAddr) {
  if (!emailAddr) return null;
  const domain = emailAddr.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  for (const [key, name] of KNOWN_ENTRIES) {
    if (domain === key || domain.endsWith('.' + key)) return name;
  }
  for (const [key, name] of KNOWN_ENTRIES) {
    if (domain.includes(key.split('.')[0])) return name;
  }
  return null;
}

function detectFromSubject(email) {
  if (!email?.subject) return null;
  const subject = email.subject.toLowerCase();
  const subjectServices = [
    { k: 'netflix', n: 'Netflix' }, { k: 'amazon', n: 'Amazon' },
    { k: 'google', n: 'Google' }, { k: 'facebook', n: 'Facebook' },
    { k: 'instagram', n: 'Instagram' }, { k: 'twitter', n: 'Twitter' },
    { k: 'discord', n: 'Discord' }, { k: 'github', n: 'GitHub' },
    { k: 'render', n: 'Render' }, { k: 'vercel', n: 'Vercel' },
  ];
  for (const s of subjectServices) {
    if (subject.includes(s.k)) return s.n;
  }
  return null;
}

function extractFromDomain(email) {
  const domain = email.split('@')[1];
  if (!domain) return 'Unknown';
  const skip = ['amazonses', 'sendgrid', 'mailchimp', 'mailgun', 'bounces', 'postmaster'];
  const parts = domain.split('.');
  for (const s of skip) {
    if (domain.includes(s)) {
      const idx = parts.findIndex(p => p.includes(s));
      if (idx >= 0 && parts[idx + 1]) return parts[idx + 1].charAt(0).toUpperCase() + parts[idx + 1].slice(1);
      return 'Notification';
    }
  }
  let name = parts[0];
  if (['mail', 'email', 'noreply', 'notify', 'info', 'account', 'pm', 'bounces'].includes(name) && parts[1]) {
    name = parts[1];
  }
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

// ===== View Email =====
function viewEmail(index) {
  const email = emailsList[index];
  if (!email) return;

  currentViewIndex = index;
  email.read = true;

  const id = email._key || email.id || email.timestamp;
  if (!readIds.includes(id)) {
    readIds.push(id);
    localStorage.setItem('readIds', JSON.stringify(readIds));
  }

  updateTabTitle(emailsList.filter(e => !e.read).length);
  scheduleRender();

  const sender = parseSender(email.from, email);

  document.getElementById('modal-avatar').textContent = sender.name.charAt(0).toUpperCase();
  document.getElementById('modal-sender-name').textContent = sender.name;
  document.getElementById('modal-sender-email').textContent = sender.email;
  document.getElementById('modal-date').textContent = formatDate(email.timestamp);
  document.getElementById('modal-subject').textContent = email.subject || '(No Subject)';

  const body = document.getElementById('modal-body');

  if (email.htmlBody) {
    // Clean broken chars on raw string BEFORE parsing (avoids corrupting HTML attributes)
    const cleanedHtml = cleanBrokenChars(email.htmlBody);
    // Parse and sanitize the email HTML
    const doc = new DOMParser().parseFromString(cleanedHtml, 'text/html');

    // Remove dangerous elements (keep <style> — it will be safely isolated in iframe)
    doc.querySelectorAll(
      'script, iframe, object, embed, form, input, button, meta, link[rel="stylesheet"]'
    ).forEach(el => el.remove());

    // Neutralize dangerous attributes
    doc.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(attr => {
        if (/^on\w+$/i.test(attr.name)) {
          el.removeAttribute(attr.name);
        } else if ((attr.name === 'href' || attr.name === 'src' || attr.name === 'action') &&
                   /^\s*javascript:/i.test(attr.value)) {
          attr.name === 'href' ? el.setAttribute('href', '#') : el.removeAttribute(attr.name);
        }
      });
    });

    // ── Strip fixed-pixel dimension attributes ───────────────────────────────
    // HTML width/height attributes (e.g. <table width="600">) map to CSS intrinsic
    // sizes that resist max-width overrides on many browsers; removing them lets our
    // injected CSS (table-layout:fixed + width:100%) properly constrain the layout.
    doc.querySelectorAll('table, td, th, img, div, center, p, h1, h2, h3, h4, h5, h6').forEach(el => {
      const tag = el.tagName.toLowerCase();

      // Remove numeric width attribute
      if (el.hasAttribute('width') && _NUMERIC_ATTR_RE.test((el.getAttribute('width') || '').trim())) {
        el.removeAttribute('width');
      }
      // Remove numeric height attribute (preserve natural aspect ratio)
      if (el.hasAttribute('height') && _NUMERIC_ATTR_RE.test((el.getAttribute('height') || '').trim())) {
        el.removeAttribute('height');
      }

      // Clear inline pixel widths so CSS max-width:100%!important can cap them cleanly
      if (el.style.width && _PIXEL_STYLE_RE.test(el.style.width.trim())) {
        el.style.width = '';
      }
      // Clear inline pixel heights on non-images (avoids clipped content)
      if (tag !== 'img' && el.style.height && _PIXEL_STYLE_RE.test(el.style.height.trim())) {
        el.style.height = '';
      }
      // Zero out inline min-width so elements can shrink to fit the viewport
      if (el.style.minWidth && _PIXEL_STYLE_RE.test(el.style.minWidth.trim())) {
        el.style.minWidth = '0';
      }
      // Remove inline max-width overrides that would fight our reset rules
      if (/^(none|initial|unset)$/i.test((el.style.maxWidth || '').trim())) {
        el.style.maxWidth = '';
      }
    });

    // Ensure charset meta is present
    if (!doc.querySelector('meta[charset]')) {
      const m = doc.createElement('meta');
      m.setAttribute('charset', 'utf-8');
      doc.head.insertBefore(m, doc.head.firstChild);
    }

    // Open all links in new tab
    if (!doc.querySelector('base')) {
      const base = doc.createElement('base');
      base.target = '_blank';
      base.setAttribute('rel', 'noopener');
      doc.head.insertBefore(base, doc.head.firstChild);
    }

    // ── Inject comprehensive responsive reset CSS ────────────────────────────
    // Placed FIRST in <head> so email author <style> blocks load after and can
    // still adjust colours/spacing — but our !important rules on structural
    // layout always win, preventing any fixed-width element from overflowing.
    const resetStyle = doc.createElement('style');
    resetStyle.textContent =
      // 1. Root — block horizontal scroll at the document level
      'html,body{margin:0!important;padding:0!important;' +
        'width:100%!important;max-width:100%!important;overflow-x:hidden!important;}' +
      // 2. Body defaults (email author styles can still override colour/font)
      'body{padding:12px!important;font-family:"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",Arial,Helvetica,sans-serif;' +
        'font-size:14px;line-height:1.6;color:#333;word-break:break-word;}' +
      // 3. Images — never wider than container, maintain aspect ratio
      'img{max-width:100%!important;height:auto!important;}' +
      // 4. Tables — THE critical rule: fixed layout + full width so they
      //    never exceed the viewport regardless of width="600" attributes
      //    or inline style="width:600px" (stripped in pre-processing above,
      //    but this acts as a final safety net).
      'table{max-width:100%!important;width:100%!important;' +
        'table-layout:fixed!important;border-collapse:collapse!important;' +
        'min-width:0!important;}' +
      // 5. Table cells — allow shrinking, force text wrapping
      'td,th{word-break:break-word!important;overflow-wrap:break-word!important;' +
        'max-width:100%!important;min-width:0!important;}' +
      // 6. Legacy <center> tag used by many HTML email templates (e.g. Crunchyroll)
      'center{display:block!important;width:100%!important;max-width:100%!important;}' +
      // 7. Generic block wrappers — cap max-width, allow shrinking
      'div,p,section,article,header,footer,aside,main,nav{' +
        'max-width:100%!important;min-width:0!important;}' +
      // 8. Pre / code / blockquote — wrap instead of causing horizontal overflow
      'pre,code,blockquote{white-space:pre-wrap!important;' +
        'word-break:break-word!important;overflow-x:auto!important;' +
        'max-width:100%!important;}' +
      // 9. Universal box model + width cap (catches any element not covered above)
      '*{box-sizing:border-box!important;max-width:100%!important;}' +
      // 10. In-iframe media query: extra tweaks when the iframe itself is narrow
      '@media screen and (max-width:600px){' +
        'body{padding:8px!important;font-size:13px!important;}' +
        'td,th{padding:4px 6px!important;}' +
        'img{display:block!important;}' +
      '}';
    doc.head.insertBefore(resetStyle, doc.head.firstChild);

    // Ensure viewport meta is present so mobile browsers scale the iframe content correctly
    if (!doc.querySelector('meta[name="viewport"]')) {
      const vp = doc.createElement('meta');
      vp.setAttribute('name', 'viewport');
      vp.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=5.0');
      doc.head.insertBefore(vp, doc.head.firstChild);
    } else {
      // Normalise any existing viewport meta — some emails set width=600 which would
      // force the iframe to render at 600px and cause horizontal overflow.
      const existingVp = doc.querySelector('meta[name="viewport"]');
      existingVp.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=5.0');
    }

    // Render in a sandboxed iframe for complete style isolation and proper centering
    body.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.title = 'Email content';
    // allow-same-origin lets parent resize the iframe; scripts are blocked (no allow-scripts)
    iframe.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    iframe.style.cssText = 'width:100%;border:none;display:block;min-height:200px;';
    iframe.srcdoc = '<!DOCTYPE html>' + doc.documentElement.outerHTML;
    body.appendChild(iframe);

    // Auto-resize iframe to its content height.
    // scrollHeight is read from both documentElement and body for cross-browser accuracy.
    const resizeIframe = () => {
      try {
        const cd = iframe.contentDocument;
        if (!cd) return;
        const h = Math.max(
          cd.documentElement.scrollHeight || 0,
          cd.body ? cd.body.scrollHeight : 0
        );
        if (h > 0) iframe.style.height = h + 'px';
      } catch (e) {}
    };
    iframe.addEventListener('load', () => {
      resizeIframe();
      // One fallback for late-loading images/fonts; cleared when ResizeObserver is active
      let fallbackTimer = setTimeout(resizeIframe, 800);

      // ResizeObserver for live accurate sizing (debounced 100ms)
      try {
        if (typeof ResizeObserver !== 'undefined' && iframe.contentDocument?.body) {
          if (_iframeResizeObserver) _iframeResizeObserver.disconnect();
          clearTimeout(fallbackTimer); // ResizeObserver handles live resizing
          let _roTimer = null;
          _iframeResizeObserver = new ResizeObserver(() => {
            clearTimeout(_roTimer);
            _roTimer = setTimeout(resizeIframe, 100);
          });
          _iframeResizeObserver.observe(iframe.contentDocument.body);
        }
      } catch (e) {}
    });
  } else if (email.body) {
    let text = cleanBrokenChars(email.body);
    body.innerHTML = `<div style="white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word;overflow-x:hidden;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#333;">${linkify(escapeHtml(text))}</div>`;
  } else {
    body.innerHTML = '<p style="color:#888;">No content</p>';
  }

  const attachSection = document.getElementById('modal-attachments');
  const attachList = document.getElementById('attachments-list');

  if (email.attachments && email.attachments.length > 0) {
    attachSection.classList.remove('hidden');
    attachList.innerHTML = email.attachments.map((att, i) => `
      <div class="attachment-item" onclick="downloadAttachment(${index}, ${i})">
        <span>${getFileIcon(att.filename)}</span>
        <span>${escapeHtml(att.filename)}</span>
        <span style="color:#888;">(${formatSize(att.size)})</span>
      </div>
    `).join('');
  } else {
    attachSection.classList.add('hidden');
  }

  document.getElementById('email-modal').classList.add('show');
  document.body.style.overflow = 'hidden';
}

// ===== Clean broken UTF-8 / Latin-1 mojibake =====
function cleanBrokenChars(text) {
  if (!text) return '';
  return text
    // Common double-encoding artifacts
    .replace(/Â /g, ' ')
    .replace(/Â\u00a0/g, '\u00a0')
    .replace(/Â\s*/g, '')
    // Accented Latin letters (Ã-prefix mojibake → correct UTF-8)
    .replace(/Ã€/g, 'À').replace(/Ã‚/g, 'Â').replace(/Ãƒ/g, 'Ã')
    .replace(/Ã„/g, 'Ä').replace(/Ã…/g, 'Å').replace(/Ã†/g, 'Æ')
    .replace(/Ã‡/g, 'Ç').replace(/Ãˆ/g, 'È').replace(/Ã‰/g, 'É')
    .replace(/ÃŠ/g, 'Ê').replace(/Ã‹/g, 'Ë').replace(/ÃŒ/g, 'Ì')
    .replace(/ÃŽ/g, 'Î').replace(/Ã'/g, 'Ñ').replace(/Ã'/g, 'Ò')
    .replace(/Ã"/g, 'Ó').replace(/Ã"/g, 'Ô').replace(/Ã•/g, 'Õ')
    .replace(/Ã–/g, 'Ö').replace(/Ã˜/g, 'Ø').replace(/Ã™/g, 'Ù')
    .replace(/Ãš/g, 'Ú').replace(/Ã›/g, 'Û').replace(/Ãœ/g, 'Ü')
    .replace(/Ãž/g, 'Þ').replace(/ÃŸ/g, 'ß')
    .replace(/Ã /g, 'à').replace(/Ã¡/g, 'á').replace(/Ã¢/g, 'â')
    .replace(/Ã£/g, 'ã').replace(/Ã¤/g, 'ä').replace(/Ã¥/g, 'å')
    .replace(/Ã¦/g, 'æ').replace(/Ã§/g, 'ç').replace(/Ã¨/g, 'è')
    .replace(/Ã©/g, 'é').replace(/Ãª/g, 'ê').replace(/Ã«/g, 'ë')
    .replace(/Ã¬/g, 'ì').replace(/Ã­/g, 'í').replace(/Ã®/g, 'î')
    .replace(/Ã¯/g, 'ï').replace(/Ã°/g, 'ð').replace(/Ã±/g, 'ñ')
    .replace(/Ã²/g, 'ò').replace(/Ã³/g, 'ó').replace(/Ã´/g, 'ô')
    .replace(/Ãµ/g, 'õ').replace(/Ã¶/g, 'ö').replace(/Ã¸/g, 'ø')
    .replace(/Ã¹/g, 'ù').replace(/Ãº/g, 'ú').replace(/Ã»/g, 'û')
    .replace(/Ã¼/g, 'ü').replace(/Ã½/g, 'ý').replace(/Ã¾/g, 'þ')
    .replace(/Ã¿/g, 'ÿ')
    // Smart punctuation (â€-prefix mojibake → correct UTF-8)
    // IMPORTANT: longer/specific patterns must come before the short â€ catch-all.
    // UTF-8 byte interpretation through Windows-1252 (third byte → Windows-1252 char):
    //   0x98 → U+02DC (˜),  0x99 → U+2122 (™)  for single quotes
    //   0x93 → U+201C ("),  0x94 → U+201D (")  for en/em dashes
    //   0x9C → U+0153 (œ)                        for left double quote
    .replace(/â€˜/g, '\u2018').replace(/â€™/g, '\u2019')    // ' '
    .replace(/\u00e2\u20ac\u201c/g, '\u2013')                // en dash –
    .replace(/\u00e2\u20ac\u201d/g, '\u2014')                // em dash —
    .replace(/â€¦/g, '\u2026')                                // …
    .replace(/â€¢/g, '\u2022')                                // •
    .replace(/â€°/g, '\u2030')                                // ‰
    .replace(/â€œ/g, '\u201C').replace(/â€/g, '\u201D')      // " "
    // Symbols
    .replace(/Â©/g, '©').replace(/Â®/g, '®').replace(/â„¢/g, '™')
    .replace(/Â°/g, '°').replace(/Â±/g, '±').replace(/Â·/g, '·')
    .replace(/Â½/g, '½').replace(/Â¼/g, '¼').replace(/Â¾/g, '¾')
    .replace(/Â£/g, '£').replace(/â‚¬/g, '€').replace(/Â¥/g, '¥')
    .replace(/Â¢/g, '¢').replace(/Â§/g, '§').replace(/Âµ/g, 'µ')
    // Non-breaking space → regular space
    .replace(/\u00A0/g, ' ')
    // Strip C1 control characters that serve no display purpose
    .replace(/[\u0080-\u009F]/g, '');
}

function closeModal() {
  document.getElementById('email-modal').classList.remove('show');
  document.body.style.overflow = '';
  currentViewIndex = -1;
  // Disconnect the ResizeObserver that keeps the email iframe sized to its content
  if (_iframeResizeObserver) {
    _iframeResizeObserver.disconnect();
    _iframeResizeObserver = null;
  }
}

async function deleteCurrentEmail() {
  if (currentViewIndex < 0) return;
  const email = emailsList[currentViewIndex];
  if (!email) return;

  // Server-side delete
  if (email._key) {
    try {
      const params = new URLSearchParams({ key: email._key, address: email.to || currentEmail });
      // Attach any R2 attachment keys for cleanup
      if (email.attachments) {
        email.attachments.forEach(att => {
          if (att.r2Key) params.append('r2key', att.r2Key);
        });
      }
      await fetch(`/api/delete?${params}`, { method: 'DELETE' });
    } catch (e) {
      console.error('Server delete failed:', e);
    }
  }

  // Local state cleanup
  const id = email._key || email.id || email.timestamp;
  if (!deletedIds.includes(id)) {
    deletedIds.push(id);
    localStorage.setItem('deletedIds', JSON.stringify(deletedIds));
  }
  emailsList.splice(currentViewIndex, 1);
  updateTabTitle(emailsList.filter(e => !e.read).length);
  scheduleRender();
  closeModal();
  showToast('🗑️ Email deleted');
}

function viewSource() {
  if (currentViewIndex >= 0) {
    const email = emailsList[currentViewIndex];
    const source = email.rawSource || email.htmlBody || email.body || 'No source';
    document.getElementById('modal-body').innerHTML =
      `<pre style="background:#f5f5f5;padding:15px;border-radius:8px;overflow-x:auto;font-size:12px;">${escapeHtml(source)}</pre>`;
  }
}

async function downloadAttachment(ei, ai) {
  const att = emailsList[ei]?.attachments?.[ai];
  if (!att) { showToast('❌ Not available'); return; }

  try {
    // R2-backed attachment: fetch from server
    if (att.r2Key) {
      showToast('📥 Downloading...');
      const res = await fetch(`/api/attachment?key=${encodeURIComponent(att.r2Key)}`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = att.filename; a.click();
      URL.revokeObjectURL(url);
      return;
    }

    // Legacy in-memory base64 attachment
    if (!att.data) { showToast('❌ No data'); return; }
    const bytes = Uint8Array.from(atob(att.data), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: att.contentType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = att.filename; a.click();
    URL.revokeObjectURL(url);
    showToast('📥 Downloading...');
  } catch (e) { showToast('❌ Download failed'); }
}

// ===== Auto Refresh (Visibility-Aware) =====
function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshInterval = setInterval(() => {
    if (!document.hidden) refreshEmails();
  }, 5000);
}

function stopAutoRefresh() {
  if (autoRefreshInterval) { clearInterval(autoRefreshInterval); autoRefreshInterval = null; }
}

// Resume refresh when tab becomes visible
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentEmail) refreshEmails();
});

// ===== Utility Functions =====
function escapeHtml(text) {
  if (!text) return '';
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function sanitizeHtml(html) {
  if (!html) return '';
  // Parse with the browser's own HTML parser — handles all edge cases regex cannot
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Remove dangerous element types entirely (<style> is kept — it is isolated in the iframe)
  doc.querySelectorAll(
    'script, iframe, object, embed, form, input, button, meta, link[rel="stylesheet"]'
  ).forEach(el => el.remove());
  // Neutralize dangerous attributes on every remaining element
  doc.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      if (/^on\w+$/i.test(attr.name)) {
        el.removeAttribute(attr.name);
      } else if ((attr.name === 'href' || attr.name === 'src' || attr.name === 'action') &&
                 /^\s*javascript:/i.test(attr.value)) {
        attr.name === 'href' ? el.setAttribute('href', '#') : el.removeAttribute(attr.name);
      }
    });
  });
  return doc.body.innerHTML;
}

function linkify(text) {
  return text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color:#00d09c;">$1</a>');
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()} `
    + `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024, s = ['B', 'KB', 'MB'], i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
}

function getFileIcon(name) {
  if (!name) return '📎';
  const ext = name.split('.').pop().toLowerCase();
  return { pdf: '📄', doc: '📝', docx: '📝', jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', zip: '📦', mp3: '🎵', mp4: '🎬', txt: '📃' }[ext] || '📎';
}

// ===== Toast =====
let toastTimer = null;
function showToast(msg) {
  $toastMsg.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 2500);
}

// ===== QR Code =====
let qrVisible = false;

function isMobile() {
  return window.innerWidth <= 600;
}

async function toggleQR() {
  if (!currentEmail) { showToast('❌ No email to show'); return; }

  const dropdownId = isMobile() ? 'qr-dropdown-mobile' : 'qr-dropdown';
  const canvasId = isMobile() ? 'qr-canvas-mobile' : 'qr-canvas';
  const dropdown = document.getElementById(dropdownId);
  const canvas = document.getElementById(canvasId);

  if (!dropdown || !canvas) { showToast('❌ QR element not found'); return; }

  if (qrVisible) {
    document.getElementById('qr-dropdown')?.classList.add('hidden');
    document.getElementById('qr-dropdown-mobile')?.classList.add('hidden');
    qrVisible = false;
    return;
  }

  try {
    const response = await fetch(`/api/qr?email=${encodeURIComponent(currentEmail)}`);
    const data = await response.json();
    if (!response.ok || !data.qr) throw new Error(data.error || 'QR failed');

    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = function () {
      const size = isMobile() ? 160 : 200;
      canvas.width = size; canvas.height = size;
      ctx.drawImage(img, 0, 0, size, size);
      dropdown.classList.remove('hidden');
      qrVisible = true;
    };
    img.onerror = () => showToast('❌ Failed to load QR');
    img.src = data.qr;
  } catch (err) {
    showToast('❌ QR Error: ' + err.message);
  }
}

document.addEventListener('click', (e) => {
  if (qrVisible && !e.target.closest('.qr-wrapper') && !e.target.closest('.qr-wrapper-mobile') && !e.target.closest('.qr-mobile')) {
    document.getElementById('qr-dropdown')?.classList.add('hidden');
    document.getElementById('qr-dropdown-mobile')?.classList.add('hidden');
    qrVisible = false;
  }
});

function closeQR() {
  document.getElementById('qr-dropdown')?.classList.add('hidden');
  document.getElementById('qr-dropdown-mobile')?.classList.add('hidden');
  qrVisible = false;
}

// ===== Premium Preview (simple features modal → opens premium.html) =====
function openPremium() {
  // If already premium, scroll to premium dashboard
  if (localStorage.getItem('isPremium') === 'true') {
    const dash = document.getElementById('premium-dashboard');
    if (dash) {
      dash.classList.remove('hidden');
      dash.scrollIntoView({ behavior: 'smooth', block: 'start' });
      showToast('⭐ You already have Premium!');
    }
    return;
  }
  const overlay = document.getElementById('pv-overlay');
  if (overlay) {
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
}

function closePremiumPreview() {
  const overlay = document.getElementById('pv-overlay');
  if (overlay) {
    overlay.classList.remove('show');
    document.body.style.overflow = '';
  }
}

// Legacy alias kept for ESC-key listener and any residual HTML references
function closePremiumFlow() { closePremiumPreview(); }

// ===== Auth State =====
function initAuthState() {
  const username = localStorage.getItem('username');
  const isPremium = localStorage.getItem('isPremium') === 'true';
  const section = document.getElementById('auth-status-section');
  const statusText = document.getElementById('auth-status-text');
  const actionBtn = document.getElementById('auth-action-btn');
  const premBtn = document.getElementById('premium-header-btn');
  const mobileAccountHeaderBtn = document.getElementById('mobile-account-header-btn');
  const avatarEl = document.getElementById('user-avatar');
  const mobileSigninBtn = document.getElementById('mobile-signin-btn');
  const mobileSigninRow = document.getElementById('mobile-signin-row');
  if (!section) return;

  if (username) {
    // Avatar: hidden after login — Account button is the single account entry point
    if (avatarEl) {
      avatarEl.classList.add('hidden');
      avatarEl.classList.remove('premium-avatar');
    }

    statusText.textContent = isPremium
      ? `⭐ @${username}`
      : `@${username}`;
    actionBtn.innerHTML = ACCOUNT_BTN_HTML;
    actionBtn.classList.remove('signout-btn');
    actionBtn.onclick = openProfile;

    // Mobile: show Account button in header (replaces Premium button); hide middle sign-in row
    if (mobileAccountHeaderBtn) {
      mobileAccountHeaderBtn.classList.remove('hidden');
    }
    if (mobileSigninRow) mobileSigninRow.classList.add('hidden');

    // Hide the dashboard/premium button after login
    if (premBtn) {
      premBtn.classList.add('hidden');
    }

    // Show/hide premium dashboard
    updatePremiumDashboard(username, isPremium);

    // Refresh premium status from server in background (handles admin-granted premium)
    refreshPremiumStatus();
  } else {
    // Logged out: hide avatar
    if (avatarEl) {
      avatarEl.classList.add('hidden');
      avatarEl.classList.remove('premium-avatar');
    }

    statusText.textContent = '';
    actionBtn.innerHTML = SIGN_IN_BTN_HTML;
    actionBtn.classList.remove('signout-btn');
    actionBtn.onclick = openAuth;

    // Mobile: hide Account header button; show Sign In in middle row
    if (mobileAccountHeaderBtn) {
      mobileAccountHeaderBtn.classList.add('hidden');
    }
    if (mobileSigninRow) mobileSigninRow.classList.remove('hidden');

    // Not logged in: show the premium button
    if (premBtn) {
      premBtn.classList.remove('hidden');
      premBtn.textContent = '⭐ Premium';
    }

    // Hide premium dashboard
    closePremiumDashboard();
  }
}

// ===== Refresh Premium Status from Server =====
// Called after sign-in and on page load to sync premium status with server
// (handles the case where admin grants/revokes premium without a fresh sign-in)
let _premiumRefreshPending = false;
async function refreshPremiumStatus() {
  if (_premiumRefreshPending) return;
  const token = localStorage.getItem('authToken');
  if (!token) return;
  _premiumRefreshPending = true;
  try {
    const res = await fetch('/api/user/profile', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      const prevPremium = localStorage.getItem('isPremium') === 'true';
      const newPremium = !!data.isPremium;
      if (prevPremium !== newPremium) {
        localStorage.setItem('isPremium', newPremium ? 'true' : 'false');
        initAuthState();
        if (newPremium) showToast('⭐ Premium activated!');
      }
    } else if (res.status === 401) {
      // Session expired — sign out silently
      localStorage.removeItem('authToken');
      localStorage.removeItem('username');
      localStorage.removeItem('isPremium');
      initAuthState();
      showToast('🔒 Session expired. Please sign in again.');
    }
  } catch (_) { /* network error; ignore silently */ }
  finally {
    _premiumRefreshPending = false;
  }
}

// ===== Premium Dashboard =====
function closePremiumDashboard() {
  const dash = document.getElementById('premium-dashboard');
  if (dash) dash.classList.add('hidden');
}

function updatePremiumDashboard(username, isPremium) {
  const dash = document.getElementById('premium-dashboard');
  if (!dash) return;

  if (!isPremium) {
    closePremiumDashboard();
    return;
  }

  dash.classList.remove('hidden');
  document.getElementById('pdash-username').textContent = `@${username}`;
  loadSavedEmails();
  loadApiKey();
}

function switchPDashTab(tab) {
  const panels = { saved: 'pdash-saved', forwarding: 'pdash-forwarding', apikey: 'pdash-apikey' };
  Object.entries(panels).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', key !== tab);
  });
  const tabOrder = ['saved', 'forwarding', 'apikey'];
  document.querySelectorAll('.pdash-tab').forEach((t, i) => {
    t.classList.toggle('active', tabOrder[i] === tab);
  });
  if (tab === 'forwarding') loadForwardingSettings();
}

async function loadSavedEmails() {
  const token = localStorage.getItem('authToken');
  if (!token) return;
  const container = document.getElementById('saved-emails-list');
  container.innerHTML = '<div class="pdash-loading">Loading…</div>';
  try {
    const res = await fetch('/api/user/saved-emails', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="pdash-loading">${escapeHtml(data.error || 'Error')}</div>`; return; }
    renderSavedEmails(data.savedEmails || []);
  } catch (e) {
    container.innerHTML = '<div class="pdash-loading">Failed to load.</div>';
  }
}

function renderSavedEmails(list) {
  const container = document.getElementById('saved-emails-list');
  const countEl = document.getElementById('saved-email-count');
  if (countEl) countEl.textContent = `${list.length}/8`;

  if (list.length === 0) {
    container.innerHTML = '<div class="pdash-loading">No saved emails yet. Add one above.</div>';
    return;
  }
  container.innerHTML = '';
  list.forEach(e => {
    const item = document.createElement('div');
    item.className = 'saved-email-item';

    const addr = document.createElement('div');
    addr.className = 'saved-email-addr';
    addr.textContent = e.address;

    const actions = document.createElement('div');
    actions.className = 'saved-email-actions';

    const useBtn = document.createElement('button');
    useBtn.className = 'se-use-btn';
    useBtn.textContent = '📥 Use';
    useBtn.addEventListener('click', () => useSavedEmail(e.address));

    const delBtn = document.createElement('button');
    delBtn.className = 'se-rm-btn';
    delBtn.textContent = '✕';
    delBtn.title = 'Remove';
    delBtn.addEventListener('click', () => deleteSavedEmail(e.address));

    actions.appendChild(useBtn);
    actions.appendChild(delBtn);
    item.appendChild(addr);
    item.appendChild(actions);
    container.appendChild(item);
  });
}

async function deleteSavedEmail(address) {
  const token = localStorage.getItem('authToken');
  if (!token) return;
  try {
    const res = await fetch('/api/user/saved-emails', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ address })
    });
    const data = await res.json();
    if (res.ok) { renderSavedEmails(data.savedEmails); showToast('🗑️ Removed'); }
    else showToast('❌ ' + (data.error || 'Error'));
  } catch (e) { showToast('❌ Network error'); }
}

function useSavedEmail(address) {
  currentEmail = address;
  const emailDisplay = document.getElementById('email-display');
  if (emailDisplay) emailDisplay.value = address;
  emailsList = [];
  startAutoRefresh();
  scheduleRender();
  refreshEmails();
  showToast('✅ Now using ' + address);
  // Scroll to the absolute top so the user can see the email address and inbox
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadApiKey() {
  const token = localStorage.getItem('authToken');
  if (!token) return;
  const container = document.getElementById('apikey-display');
  if (!container) return;
  container.innerHTML = '<div class="pdash-loading">Loading…</div>';
  try {
    const res = await fetch('/api/user/api-key', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="pdash-loading">${escapeHtml(data.error || 'Error')}</div>`; return; }
    if (data.apiKey) {
      container.innerHTML = `
        <span class="apikey-text" id="apikey-value">${escapeHtml(data.apiKey)}</span>
        <button class="apikey-copy-btn" onclick="copyApiKey()">📋 Copy</button>
      `;
    } else {
      container.innerHTML = '<span class="apikey-none">No API key yet — generate one below.</span>';
    }
  } catch (e) {
    container.innerHTML = '<div class="pdash-loading">Failed to load.</div>';
  }
}

async function generateApiKey() {
  const token = localStorage.getItem('authToken');
  if (!token) return;
  try {
    const res = await fetch('/api/user/api-key', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok) {
      const container = document.getElementById('apikey-display');
      if (container) container.innerHTML = `
        <span class="apikey-text" id="apikey-value">${escapeHtml(data.apiKey)}</span>
        <button class="apikey-copy-btn" onclick="copyApiKey()">📋 Copy</button>
      `;
      showToast('🔑 New API key generated!');
    } else {
      showToast('❌ ' + (data.error || 'Error'));
    }
  } catch (e) { showToast('❌ Network error'); }
}

function copyApiKey() {
  const el = document.getElementById('apikey-value');
  if (!el) return;
  navigator.clipboard.writeText(el.textContent)
    .then(() => showToast('📋 API key copied!'))
    .catch(() => showToast('❌ Copy failed'));
}

/**
 * Dismiss a modal with a fade-out animation, then hide it via display:none.
 * Adds the `.hiding` class (which triggers the CSS @keyframes overlayFadeOut),
 * then removes it once the animation ends (falling back to a timeout so the
 * class is always cleaned up even when animationend doesn't fire).
 */
function _dismissModal(el) {
  if (!el || !el.classList.contains('show')) return;
  el.classList.remove('show');
  el.classList.add('hiding');
  const cleanup = () => el.classList.remove('hiding');
  el.addEventListener('animationend', cleanup, { once: true });
  // Safety fallback in case animationend doesn't fire
  setTimeout(cleanup, 400);
}

function confirmSignOut() {
  const modal = document.getElementById('signout-confirm-modal');
  if (modal) {
    modal.classList.remove('hiding');
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  } else {
    doSignOut();
  }
}

function closeSignOutConfirm() {
  _dismissModal(document.getElementById('signout-confirm-modal'));
  document.body.style.overflow = '';
}

function doSignOut() {
  closeSignOutConfirm();
  localStorage.removeItem('authToken');
  localStorage.removeItem('username');
  localStorage.removeItem('isPremium');
  closePremiumFlow();
  showToast('👋 Signed out');
  initAuthState();
}

// ===== Auth Modal =====
function openAuth() {
  document.getElementById('auth-modal').classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeAuth() {
  document.getElementById('auth-modal').classList.remove('show');
  document.body.style.overflow = '';
  document.getElementById('signin-username').value = '';
  document.getElementById('signin-password').value = '';
  document.getElementById('signup-username').value = '';
  document.getElementById('signup-password').value = '';
  document.getElementById('signup-email').value = '';
  document.getElementById('auth-error').classList.add('hidden');
}

function switchAuthTab(tab) {
  const isSignin = tab === 'signin';
  document.getElementById('signin-section').classList.toggle('hidden', !isSignin);
  document.getElementById('signup-section').classList.toggle('hidden', isSignin);
  document.getElementById('tab-signin').classList.toggle('active', isSignin);
  document.getElementById('tab-signup').classList.toggle('active', !isSignin);
  document.getElementById('auth-modal-title').textContent = isSignin ? '👻 Sign In' : '👻 Create Account';
  document.getElementById('auth-error').classList.add('hidden');
}

async function signIn() {
  const username = document.getElementById('signin-username').value.trim();
  const password = document.getElementById('signin-password').value;
  if (!username || !password) { showAuthError('Please enter username and password'); return; }

  const btn = document.querySelector('#signin-section .auth-verify-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }

  try {
    const res = await fetch('/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem('authToken', data.token);
      localStorage.setItem('username', data.username);
      localStorage.setItem('isPremium', data.isPremium ? 'true' : 'false');
      closeAuth();
      closePremiumFlow();
      initAuthState();
      showToast(data.isPremium ? '⭐ Welcome back, Premium!' : '✅ Signed in!');
    } else {
      showAuthError(data.error || 'Sign in failed');
    }
  } catch (e) { showAuthError('Network error. Try again.'); }
  finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }
  }
}

async function signUp() {
  const username = document.getElementById('signup-username').value.trim();
  const password = document.getElementById('signup-password').value;
  const email = document.getElementById('signup-email').value.trim();
  if (!username || !password) { showAuthError('Username and password are required'); return; }

  const btn = document.querySelector('#signup-section .auth-verify-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }

  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, email: email || "" })
    });
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem('authToken', data.token);
      localStorage.setItem('username', data.username);
      localStorage.setItem('isPremium', 'false');
      closeAuth();
      initAuthState();
      showToast('🎉 Account created!');
    } else {
      showAuthError(data.error || 'Signup failed');
    }
  } catch (e) { showAuthError('Network error. Try again.'); }
  finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Create Account'; }
  }
}

function showAuthError(msg) {
  const errEl = document.getElementById('auth-error');
  errEl.textContent = msg;
  errEl.classList.remove('hidden');
}

// ===== About Modal =====
function openAbout() {
  document.getElementById('about-modal').classList.add('show');
  document.body.style.overflow = 'hidden';
}
function closeAbout() {
  document.getElementById('about-modal').classList.remove('show');
  document.body.style.overflow = '';
}

// ===== Profile Modal =====
async function openProfile() {
  const modal = document.getElementById('profile-modal');
  if (!modal) return;
  modal.classList.remove('hiding');
  modal.classList.add('show');
  document.body.style.overflow = 'hidden';
  await loadProfileData();
}

function closeProfile() {
  _dismissModal(document.getElementById('profile-modal'));
  document.body.style.overflow = '';
}

async function loadProfileData() {
  const bodyEl = document.getElementById('profile-body');
  if (!bodyEl) return;
  const token = localStorage.getItem('authToken');
  const username = localStorage.getItem('username');
  if (!token || !username) {
    bodyEl.innerHTML = '<div class="profile-loading">Not signed in.</div>';
    return;
  }
  try {
    const res = await fetch('/api/user/profile', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) { bodyEl.innerHTML = `<div class="profile-loading">${escapeHtml(data.error || 'Error')}</div>`; return; }
    renderProfileData(data);
  } catch (e) {
    bodyEl.innerHTML = '<div class="profile-loading">Failed to load profile.</div>';
  }
}

function renderProfileData(data) {
  const bodyEl = document.getElementById('profile-body');
  if (!bodyEl) return;
  const { username, isPremium, premiumExpiry } = data;
  const avatarLetter = username ? username[0].toUpperCase() : '?';

  let remainingStr = 'N/A';
  let expiryStr = 'N/A';
  if (isPremium && premiumExpiry) {
    const now = Date.now();
    const diff = premiumExpiry - now;
    if (diff > 0) {
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      remainingStr = days > 0 ? `${days} day${days !== 1 ? 's' : ''} left` : `${hours}h left`;
      expiryStr = new Date(premiumExpiry).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } else {
      remainingStr = 'Expired';
      expiryStr = 'Expired';
    }
  }

  const planLabel = isPremium ? '⭐ Premium' : 'Free';
  const planClass = isPremium ? 'premium' : '';

  bodyEl.innerHTML = `
    <div class="profile-avatar-row">
      <div class="profile-big-avatar ${planClass}">${escapeHtml(avatarLetter)}</div>
      <div>
        <div class="profile-username">@${escapeHtml(username)}</div>
        <div class="profile-plan-badge ${planClass}">${planLabel}</div>
      </div>
    </div>
    <div class="profile-info-grid">
      <div class="profile-info-card">
        <div class="profile-info-label">Plan</div>
        <div class="profile-info-value ${planClass}">${planLabel}</div>
      </div>
      <div class="profile-info-card">
        <div class="profile-info-label">Status</div>
        <div class="profile-info-value ${isPremium ? 'green' : ''}">${isPremium ? 'Active' : 'Free'}</div>
      </div>
      ${isPremium ? `
      <div class="profile-info-card">
        <div class="profile-info-label">Expires</div>
        <div class="profile-info-value">${escapeHtml(expiryStr)}</div>
      </div>
      <div class="profile-info-card">
        <div class="profile-info-label">Remaining</div>
        <div class="profile-info-value gold">${escapeHtml(remainingStr)}</div>
      </div>
      ` : ''}
    </div>

    <!-- Change Password -->
    <div class="profile-section">
      <div class="profile-section-title">🔑 Change Password</div>
      <div class="profile-form" id="change-pw-form">
        <input type="password" id="pw-old" class="profile-input" placeholder="Current password" autocomplete="current-password">
        <input type="password" id="pw-new" class="profile-input" placeholder="New password (min 8 chars)" autocomplete="new-password">
        <input type="password" id="pw-confirm" class="profile-input" placeholder="Confirm new password" autocomplete="new-password">
        <p class="profile-form-error hidden" id="pw-error"></p>
        <button class="profile-form-btn" onclick="changePassword()">Update Password</button>
      </div>
    </div>

    <div class="profile-actions">
      ${!isPremium ? `<button class="profile-action-btn" onclick="closeProfile();openPremium();">⭐ Upgrade to Premium</button>` : ''}
      <button class="profile-action-btn danger" onclick="closeProfile();confirmSignOut();">Sign Out</button>
    </div>

    <!-- Delete Account -->
    <div class="profile-section profile-danger-zone">
      <div class="profile-section-title danger">⚠️ Danger Zone</div>
      <p class="profile-danger-desc">Deleting your account is permanent and cannot be undone. All saved emails and settings will be removed.</p>
      <button class="profile-action-btn danger" onclick="showDeleteAccountForm()">🗑️ Delete Account</button>
      <div class="profile-form hidden" id="delete-account-form">
        <input type="password" id="del-pw" class="profile-input" placeholder="Enter your password to confirm" autocomplete="current-password">
        <p class="profile-form-error hidden" id="del-error"></p>
        <div class="confirm-actions" style="margin-top:10px;">
          <button class="confirm-cancel-btn" onclick="hideDeleteAccountForm()">Cancel</button>
          <button class="confirm-ok-btn danger" onclick="deleteAccount()">Delete My Account</button>
        </div>
      </div>
    </div>
  `;
}

// ===== Change Password =====
async function changePassword() {
  const oldPw = document.getElementById('pw-old')?.value || '';
  const newPw = document.getElementById('pw-new')?.value || '';
  const confirmPw = document.getElementById('pw-confirm')?.value || '';
  const errEl = document.getElementById('pw-error');

  if (errEl) { errEl.classList.add('hidden'); errEl.textContent = ''; }

  if (!oldPw || !newPw || !confirmPw) {
    if (errEl) { errEl.textContent = 'All fields are required.'; errEl.classList.remove('hidden'); }
    return;
  }
  if (newPw.length < 8) {
    if (errEl) { errEl.textContent = 'New password must be at least 8 characters.'; errEl.classList.remove('hidden'); }
    return;
  }
  if (newPw !== confirmPw) {
    if (errEl) { errEl.textContent = 'New passwords do not match.'; errEl.classList.remove('hidden'); }
    return;
  }

  const token = localStorage.getItem('authToken');
  if (!token) return;

  const btn = document.querySelector('#change-pw-form .profile-form-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Updating…'; }

  try {
    const res = await fetch('/api/user/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw })
    });
    const data = await res.json();
    if (res.ok) {
      document.getElementById('pw-old').value = '';
      document.getElementById('pw-new').value = '';
      document.getElementById('pw-confirm').value = '';
      showToast('✅ Password updated!');
    } else {
      if (errEl) { errEl.textContent = data.error || 'Failed to update password.'; errEl.classList.remove('hidden'); }
    }
  } catch (e) {
    if (errEl) { errEl.textContent = 'Network error. Try again.'; errEl.classList.remove('hidden'); }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Update Password'; }
  }
}

// ===== Delete Account =====
function showDeleteAccountForm() {
  const form = document.getElementById('delete-account-form');
  if (form) form.classList.remove('hidden');
}

function hideDeleteAccountForm() {
  const form = document.getElementById('delete-account-form');
  if (form) { form.classList.add('hidden'); document.getElementById('del-pw').value = ''; }
  const errEl = document.getElementById('del-error');
  if (errEl) errEl.classList.add('hidden');
}

async function deleteAccount() {
  const pw = document.getElementById('del-pw')?.value || '';
  const errEl = document.getElementById('del-error');
  if (errEl) { errEl.classList.add('hidden'); errEl.textContent = ''; }

  if (!pw) {
    if (errEl) { errEl.textContent = 'Password is required.'; errEl.classList.remove('hidden'); }
    return;
  }

  const token = localStorage.getItem('authToken');
  if (!token) return;

  const btn = document.querySelector('#delete-account-form .confirm-ok-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }

  try {
    const res = await fetch('/api/user/profile', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ password: pw })
    });
    const data = await res.json();
    if (res.ok) {
      closeProfile();
      localStorage.removeItem('authToken');
      localStorage.removeItem('username');
      localStorage.removeItem('isPremium');
      initAuthState();
      showToast('🗑️ Account deleted.');
    } else {
      if (errEl) { errEl.textContent = data.error || 'Failed to delete account.'; errEl.classList.remove('hidden'); }
    }
  } catch (e) {
    if (errEl) { errEl.textContent = 'Network error. Try again.'; errEl.classList.remove('hidden'); }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Delete My Account'; }
  }
}


async function saveCurrentEmail() {
  if (!currentEmail) { showToast('❌ No email to save'); return; }
  const token = localStorage.getItem('authToken');
  if (!token) {
    showPremiumRequiredPrompt('🔐 Sign in & get Premium to save emails permanently.');
    return;
  }
  const isPremium = localStorage.getItem('isPremium') === 'true';
  if (!isPremium) {
    showPremiumRequiredPrompt('⭐ Premium required to save emails permanently.');
    return;
  }
  try {
    const res = await fetch('/api/user/saved-emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ address: currentEmail })
    });
    const data = await res.json();
    if (res.ok) { showToast('✅ Email saved to your account!'); loadSavedEmails(); }
    else showToast('❌ ' + (data.error || 'Could not save'));
  } catch (e) { showToast('❌ Network error'); }
}

function showPremiumRequiredPrompt(message) {
  const modal = document.getElementById('premium-required-modal');
  const msg = document.getElementById('premium-required-msg');
  const signInBtn = document.getElementById('premium-prompt-signin-btn');
  if (!modal) { openPremium(); return; }
  if (msg) msg.textContent = message;
  // Hide "Sign In" button when the user is already signed in (non-premium)
  if (signInBtn) {
    const isLoggedIn = !!localStorage.getItem('authToken');
    signInBtn.style.display = isLoggedIn ? 'none' : '';
  }
  modal.classList.remove('hiding');
  modal.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closePremiumRequiredPrompt() {
  _dismissModal(document.getElementById('premium-required-modal'));
  document.body.style.overflow = '';
}

function premiumRequiredSignIn() {
  closePremiumRequiredPrompt();
  openAuth();
}

function premiumRequiredGetPremium() {
  closePremiumRequiredPrompt();
  openPremium();
}

async function addPermanentEmail() {
  const input = document.getElementById('perm-username-input');
  const errEl = document.getElementById('perm-email-error');
  const username = (input?.value || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (errEl) errEl.classList.add('hidden');
  if (!username || username.length < 3 || !PERM_USERNAME_RE.test(username)) {
    if (errEl) { errEl.textContent = 'Username must be at least 3 characters.'; errEl.classList.remove('hidden'); }
    return;
  }
  if (username.length > 30) {
    if (errEl) { errEl.textContent = 'Username must be 30 characters or less.'; errEl.classList.remove('hidden'); }
    return;
  }
  const address = `${username}${PERM_EMAIL_DOMAIN}`;
  const token = localStorage.getItem('authToken');
  if (!token) return;
  try {
    const res = await fetch('/api/user/saved-emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ address })
    });
    const data = await res.json();
    if (res.ok) {
      if (input) input.value = '';
      showToast('✅ Permanent email created!');
      loadSavedEmails();
    } else {
      if (errEl) { errEl.textContent = data.error || 'Error creating email'; errEl.classList.remove('hidden'); }
    }
  } catch (e) {
    if (errEl) { errEl.textContent = 'Network error. Try again.'; errEl.classList.remove('hidden'); }
  }
}

// ===== Email Forwarding (Premium) =====
async function loadForwardingSettings() {
  const token = localStorage.getItem('authToken');
  if (!token) return;
  const container = document.getElementById('forwarding-list');
  if (!container) return;
  container.innerHTML = '<div class="pdash-loading">Loading…</div>';
  try {
    const res = await fetch('/api/user/saved-emails', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="pdash-loading">${escapeHtml(data.error || 'Error')}</div>`; return; }
    const savedEmails = (data.savedEmails || []).filter(e => e.address && e.address.endsWith(PERM_EMAIL_DOMAIN));
    renderForwardingSettings(savedEmails);
  } catch (e) {
    container.innerHTML = '<div class="pdash-loading">Failed to load.</div>';
  }
}

function renderForwardingSettings(list) {
  const container = document.getElementById('forwarding-list');
  if (!container) return;
  if (list.length === 0) {
    container.innerHTML = '<div class="pdash-loading">No permanent addresses found. Create one in the Permanent Email tab first.</div>';
    return;
  }
  container.innerHTML = '';
  list.forEach(e => {
    const item = document.createElement('div');
    item.className = 'forwarding-item';

    const addrDiv = document.createElement('div');
    addrDiv.className = 'forwarding-item-addr';
    addrDiv.textContent = e.address;

    const row = document.createElement('div');
    row.className = 'forwarding-row';

    const fwdInput = document.createElement('input');
    fwdInput.type = 'email';
    fwdInput.className = 'forwarding-input';
    fwdInput.placeholder = 'Forward to: you@gmail.com';
    fwdInput.value = e.forwarding || '';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'forwarding-save-btn';
    saveBtn.textContent = '💾 Save';
    saveBtn.addEventListener('click', () => saveForwarding(e.address, fwdInput));

    row.appendChild(fwdInput);
    row.appendChild(saveBtn);

    if (e.forwarding) {
      const clearBtn = document.createElement('button');
      clearBtn.className = 'forwarding-clear-btn';
      clearBtn.textContent = '✕';
      clearBtn.addEventListener('click', () => clearForwarding(e.address));
      row.appendChild(clearBtn);
    }

    item.appendChild(addrDiv);
    item.appendChild(row);

    if (e.forwarding) {
      const statusDiv = document.createElement('div');
      statusDiv.style.cssText = 'font-size:12px;color:#00d09c;margin-top:6px;';
      statusDiv.textContent = `✓ Forwarding to ${e.forwarding}`;
      item.appendChild(statusDiv);
    }

    container.appendChild(item);
  });
}

async function saveForwarding(address, input) {
  const forwardTo = input?.value?.trim() || '';
  const token = localStorage.getItem('authToken');
  if (!token) return;
  if (forwardTo && !forwardTo.includes('@')) { showToast('❌ Enter a valid email address'); return; }
  try {
    const res = await fetch('/api/user/forwarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ address, forwardTo: forwardTo || null })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(forwardTo ? `✅ Forwarding enabled!` : '✅ Forwarding disabled');
      loadForwardingSettings();
    } else {
      showToast('❌ ' + (data.error || 'Error'));
    }
  } catch (e) { showToast('❌ Network error'); }
}

async function clearForwarding(address) {
  const token = localStorage.getItem('authToken');
  if (!token) return;
  try {
    const res = await fetch('/api/user/forwarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ address, forwardTo: null })
    });
    const data = await res.json();
    if (res.ok) { showToast('✅ Forwarding removed'); loadForwardingSettings(); }
    else showToast('❌ ' + (data.error || 'Error'));
  } catch (e) { showToast('❌ Network error'); }
}

// ===== Global Key/Click Listeners =====
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal(); closeAbout(); closeQR(); closePremiumFlow(); closeAuth(); closeProfile();
    closeSignOutConfirm(); closePremiumRequiredPrompt();
  }
});

document.getElementById('email-modal')?.addEventListener('click', e => { if (e.target.id === 'email-modal') closeModal(); });
document.getElementById('about-modal')?.addEventListener('click', e => { if (e.target.id === 'about-modal') closeAbout(); });
document.getElementById('qr-modal')?.addEventListener('click', e => { if (e.target.id === 'qr-modal') closeQR(); });
document.getElementById('auth-modal')?.addEventListener('click', e => { if (e.target.id === 'auth-modal') closeAuth(); });
document.getElementById('profile-modal')?.addEventListener('click', e => { if (e.target.id === 'profile-modal') closeProfile(); });

// Initialize auth state on load
document.addEventListener('DOMContentLoaded', initAuthState);
