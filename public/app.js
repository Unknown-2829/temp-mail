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

// ── Compose / Sent state ──────────────────────────────────────
let composeMinimized = false;
let composeIsHtml = true;
let sentList = [];
let sentBoxOpen = false;
let composeAttachments = []; // {filename, content (base64), size, type}
let _composeDragInited = false;
let _composeDragActive = false;
let _composeDragStartX = 0, _composeDragStartY = 0;
let _composeDragWinX = 0, _composeDragWinY = 0;

// ResizeObserver used to keep the email iframe height in sync with its content.
// Stored here so closeModal() can disconnect it and prevent memory leaks.
let _iframeResizeObserver = null;

// Tracks whether the email modal is currently showing raw source instead of rendered email.
let _isSourceView = false;

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
    loadSentEmails();
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

  await new Promise(r => setTimeout(r, 500));

  try {
    const token = localStorage.getItem('authToken');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const response = await fetch('/api/generate', { method: 'POST', headers });
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
      // Re-poll in case more emails arrive in rapid succession
      setTimeout(() => { if (!document.hidden && currentEmail) refreshEmails(); }, 3000);
    }

    const unreadCount = emailsList.filter(e => !e.read).length;
    updateTabTitle(unreadCount);

    scheduleRender();
    loadSentEmails();
  } catch (e) {
    _refreshErrorCount++;
    if (_refreshErrorCount === 1) console.error('Refresh error #' + _refreshErrorCount, e);
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

  // Preserve scroll position across re-renders (e.g. read-state changes).
  // Only reset to top when the inbox was previously empty (first batch of emails arriving).
  const wasEmpty = $inboxBody.innerHTML === '' ||
    $inboxBody.querySelector('.empty-inbox') !== null;
  const savedScroll = wasEmpty ? 0 : $inboxBody.scrollTop;

  $inboxBody.innerHTML = rows;
  $inboxBody.scrollTop = savedScroll;
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
async function viewEmail(index) {
  const email = emailsList[index];
  if (!email) return;

  // Always start in rendered-email view (not source)
  _isSourceView = false;
  _updateSourceBtn(false);

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

  // Show To / CC / BCC rows only when the field is actually present
  const metaRows = document.getElementById('modal-meta-rows');
  metaRows.innerHTML = '';
  const addMetaRow = (label, value) => {
    if (!value) return;
    const row = document.createElement('div');
    row.className = 'modal-meta-row';
    row.innerHTML = `<span class="modal-meta-label">${label}</span><span class="modal-meta-value">${escapeHtml(value)}</span>`;
    metaRows.appendChild(row);
  };
  addMetaRow('To:', email.headers?.to || email.to || '');
  addMetaRow('CC:', email.headers?.cc || '');
  addMetaRow('BCC:', email.headers?.bcc || '');

  // Open the modal immediately so the user sees the header/metadata right away
  _pushModalHistory();
  document.getElementById('email-modal').classList.add('show');
  document.body.style.overflow = 'hidden';

  const body = document.getElementById('modal-body');

  // If the body content was stripped from the list response, fetch it now on demand
  if (!email.htmlBody && !email.body && !email.rawSource && email._key) {
    body.innerHTML = '<p style="color:#888;font-size:14px;text-align:center;padding:24px 0;">⏳ Loading…</p>';
    try {
      const params = new URLSearchParams({ key: email._key, address: email.to || currentEmail });
      const res = await fetch(`/api/email?${params}`);
      if (res.ok) {
        const data = await res.json();
        if (data.email) {
          // Merge full content back into the cached entry so re-opens are instant
          Object.assign(email, data.email);
        }
      }
    } catch (_) {
      // Network error — body will show "No content"; user can close and re-open to retry
      console.warn('Failed to fetch email body:', _);
    }
  }

  _renderEmailBody(email, body);

  const attachSection = document.getElementById('modal-attachments');
  const attachList = document.getElementById('attachments-list');

  if (email.attachments && email.attachments.length > 0) {
    attachSection.classList.remove('hidden');
    attachList.innerHTML = '';

    const imageExts = ['jpg','jpeg','png','gif','webp','svg','bmp','ico','avif'];
    const audioExts = ['mp3','wav','ogg','m4a','flac','aac','opus'];
    const videoExts = ['mp4','webm','ogv','mov','avi','mkv'];
    const codeExts  = ['txt','py','js','ts','jsx','tsx','json','xml','csv',
                       'html','css','md','sh','bash','yml','yaml','env',
                       'log','ini','toml','rs','go','java','cpp','c','h',
                       'php','rb','swift','kt','dart','sql'];

    const images = email.attachments.filter(a => {
      const ext = (a.filename||'').split('.').pop().toLowerCase();
      return imageExts.includes(ext);
    });
    const others = email.attachments.filter(a => {
      const ext = (a.filename||'').split('.').pop().toLowerCase();
      return !imageExts.includes(ext);
    });

    // Index of this email — needed by downloadAttachment()
    const ei = emailsList.indexOf(email);

    // ── IMAGE GRID ──────────────────────────────────────────────
    if (images.length > 0) {
      const gridDiv = document.createElement('div');
      const cols = images.length === 1 ? 1 : images.length <= 3 ? 2 : 3;
      gridDiv.className = `att-image-grid att-cols-${cols}`;

      images.forEach(att => {
        const ai = email.attachments.indexOf(att);
        const src = att.r2Key
          ? `/api/attachment?key=${encodeURIComponent(att.r2Key)}`
          : (att.data ? `data:${att.contentType||'image/jpeg'};base64,${att.data}` : null);
        if (!src) return;

        const cell = document.createElement('div');
        cell.className = 'att-img-cell';
        const img = document.createElement('img');
        img.src = src;
        img.alt = att.filename || 'image';
        img.loading = 'lazy';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;cursor:zoom-in;border-radius:6px;';
        img.onclick = () => openAttLightbox(src, att.filename, att.contentType);
        const label = document.createElement('div');
        label.className = 'att-img-label';
        label.textContent = att.filename || 'image';
        // Download button overlay (top-right corner)
        const dlBtn = document.createElement('button');
        dlBtn.className = 'att-img-dl-btn';
        dlBtn.title = 'Download';
        dlBtn.textContent = '⬇';
        dlBtn.addEventListener('click', (e) => { e.stopPropagation(); downloadAttachment(ei, ai); });
        cell.appendChild(img);
        cell.appendChild(label);
        cell.appendChild(dlBtn);
        gridDiv.appendChild(cell);
      });
      attachList.appendChild(gridDiv);
    }

    // ── OTHER ATTACHMENTS ────────────────────────────────────────
    others.forEach(att => {
      const ext = (att.filename||'').split('.').pop().toLowerCase();
      const ai = email.attachments.indexOf(att);
      const card = document.createElement('div');
      card.className = 'att-card';

      const src = att.r2Key
        ? `/api/attachment?key=${encodeURIComponent(att.r2Key)}`
        : null;

      // Helper: wire up the download button after innerHTML is set
      const wireDownload = () => {
        const dlBtn = card.querySelector('.att-download-btn');
        if (dlBtn) dlBtn.addEventListener('click', (e) => { e.stopPropagation(); downloadAttachment(ei, ai); });
      };

      // AUDIO
      if (audioExts.includes(ext)) {
        card.innerHTML = `
          <div class="att-card-info">
            <span class="att-card-icon">🎵</span>
            <div class="att-card-meta">
              <div class="att-card-name">${escapeHtml(att.filename||'audio')}</div>
              <div class="att-card-size">${formatSize(att.size)}</div>
            </div>
            <button class="att-download-btn" title="Download file">⬇ Download</button>
          </div>
          <audio controls style="width:100%;margin-top:8px;border-radius:6px;">
            <source src="${src||''}" type="${att.contentType||'audio/mpeg'}">
          </audio>`;
        wireDownload();

      // VIDEO
      } else if (videoExts.includes(ext)) {
        card.innerHTML = `
          <div class="att-card-info">
            <span class="att-card-icon">🎬</span>
            <div class="att-card-meta">
              <div class="att-card-name">${escapeHtml(att.filename||'video')}</div>
              <div class="att-card-size">${formatSize(att.size)}</div>
            </div>
            <button class="att-download-btn" title="Download file">⬇ Download</button>
          </div>
          <video controls style="width:100%;max-height:280px;border-radius:6px;margin-top:8px;background:#000;">
            <source src="${src||''}" type="${att.contentType||'video/mp4'}">
          </video>`;
        wireDownload();
        card.onclick = (e) => {
          const tag = e.target.tagName.toUpperCase();
          if (tag !== 'VIDEO' && tag !== 'SOURCE' && tag !== 'BUTTON')
            openAttLightbox(src, att.filename, att.contentType);
        };

      // PDF — opens in lightbox; separate download button
      } else if (ext === 'pdf') {
        card.className += ' att-card-clickable';
        card.title = 'Click to open PDF';
        card.innerHTML = `
          <div class="att-card-info">
            <span class="att-card-icon">📄</span>
            <div class="att-card-meta">
              <div class="att-card-name">${escapeHtml(att.filename||'document.pdf')}</div>
              <div class="att-card-size">${formatSize(att.size)} · PDF</div>
            </div>
            <span class="att-card-action">↗</span>
            <button class="att-download-btn" title="Download file">⬇</button>
          </div>`;
        wireDownload();
        card.onclick = (e) => { if (e.target.tagName !== 'BUTTON' && src) openAttLightbox(src, att.filename, 'application/pdf'); };

      // CODE / TEXT — opens content in new tab; separate download button
      } else if (codeExts.includes(ext)) {
        const langIcon = {'py':'🐍','js':'🟨','ts':'🔷','json':'📋','md':'📝',
          'html':'🌐','css':'🎨','sh':'⚙️','sql':'🗄️','yml':'⚙️','yaml':'⚙️'}[ext] || '📃';
        card.className += ' att-card-clickable';
        card.title = 'Click to view file';
        card.innerHTML = `
          <div class="att-card-info">
            <span class="att-card-icon">${langIcon}</span>
            <div class="att-card-meta">
              <div class="att-card-name">${escapeHtml(att.filename||'file')}</div>
              <div class="att-card-size">${formatSize(att.size)} · ${ext.toUpperCase()}</div>
            </div>
            <span class="att-card-action">↗</span>
            <button class="att-download-btn" title="Download file">⬇</button>
          </div>`;
        wireDownload();
        card.onclick = async (e) => {
          if (e.target.tagName === 'BUTTON') return;
          try {
            if (src) {
              const res = await fetch(src);
              const text = await res.text();
              const blob = new Blob([text], {type:'text/plain'});
              window.open(URL.createObjectURL(blob), '_blank');
            } else if (att.data) {
              const bytes = Uint8Array.from(atob(att.data), c => c.charCodeAt(0));
              const text = new TextDecoder('utf-8').decode(bytes);
              const blob = new Blob([text], {type:'text/plain'});
              window.open(URL.createObjectURL(blob), '_blank');
            }
          } catch(e) { showToast('❌ Could not open file'); }
        };

      // EVERYTHING ELSE — whole card + dedicated button both trigger download
      } else {
        card.className += ' att-card-clickable';
        card.title = 'Click to download';
        card.innerHTML = `
          <div class="att-card-info">
            <span class="att-card-icon">${getFileIcon(att.filename)}</span>
            <div class="att-card-meta">
              <div class="att-card-name">${escapeHtml(att.filename||'file')}</div>
              <div class="att-card-size">${formatSize(att.size)}</div>
            </div>
            <button class="att-download-btn" title="Download file">⬇ Download</button>
          </div>`;
        wireDownload();
        card.onclick = (e) => { if (e.target.tagName !== 'BUTTON') downloadAttachment(ei, ai); };
      }

      attachList.appendChild(card);
    });
  } else {
    attachSection.classList.add('hidden');
  }
}

// ===== Render Email Body =====
function _renderEmailBody(email, body) {
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

    // Upgrade HTTP media/image src attributes to HTTPS so they are not blocked by the
    // browser's mixed-content protection (the parent page is always served over HTTPS).
    // This covers <img src>, <source src>, <video src/poster> and <audio src>.
    const upgradeHttp = (el, attr) => {
      const val = el.getAttribute(attr);
      if (val && /^http:\/\//i.test(val)) el.setAttribute(attr, val.replace(/^http:\/\//i, 'https://'));
    };
    doc.querySelectorAll('img[src], source[src], video[src], audio[src]').forEach(el => upgradeHttp(el, 'src'));
    doc.querySelectorAll('video[poster]').forEach(el => upgradeHttp(el, 'poster'));

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
    // allow-scripts is needed for external images to load; scripts are blocked by the CSP meta below
    iframe.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-scripts');
    iframe.style.cssText = 'width:100%;border:none;display:block;min-height:200px;';

    // Add CSP meta to <head> — block scripts inside emails for security, but allow
    // all external HTTP + HTTPS images, fonts, styles, and media to load freely.
    const cspMeta = doc.createElement('meta');
    cspMeta.setAttribute('http-equiv', 'Content-Security-Policy');
    cspMeta.setAttribute('content',
      "default-src 'none'; " +
      "img-src * http: https: data: blob:; " +
      "style-src 'unsafe-inline' * http: https:; " +
      "font-src * http: https: data:; " +
      "media-src * http: https: data: blob:; " +
      "script-src 'none';"
    );
    doc.head.insertBefore(cspMeta, doc.head.firstChild);

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
    body.innerHTML = `<div style="white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word;overflow-x:hidden;font-family:'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;">${linkify(escapeHtml(text))}</div>`;
  } else if (email.rawSource) {
    // Parsed body is empty but raw source exists — invite the user to inspect it
    body.innerHTML = '<p style="color:#888;font-size:14px;">Email body could not be displayed. <a id="view-source-link" href="#" style="color:#00d09c;text-decoration:none;font-weight:600;">View raw source ›</a></p>';
    const srcLink = document.getElementById('view-source-link');
    if (srcLink) srcLink.addEventListener('click', (e) => { e.preventDefault(); viewSource(); });
  } else {
    body.innerHTML = '<p style="color:#888;">No content</p>';
  }
}

// ===== Clean broken UTF-8 / Latin-1 mojibake =====
function cleanBrokenChars(text) {
  if (!text) return '';

  // Attempt to re-decode text that was stored as a Latin-1/Windows-1252 byte string
  // instead of a proper JS Unicode string. This happens when a server-side decoder
  // ran UTF-8 bytes through charCodeAt() one byte at a time.
  // Only re-decode when ALL characters are in the Latin-1 range (≤ U+00FF) and there
  // are byte sequences that look like multi-byte UTF-8 leads (0xC0-0xFF).
  // Skip HTML content to avoid corrupting attribute values and tag names.
  const seemsMojibake = /[\xC0-\xFF][\x80-\xBF]/.test(text);
  const looksLikeHtml = /<[a-zA-Z]/.test(text);
  if (seemsMojibake && !looksLikeHtml) {
    try {
      const bytes = Uint8Array.from(text, c => c.charCodeAt(0));
      const redecoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      // Use the re-decoded string only when it actually differs (avoids no-op cost)
      if (redecoded !== text) text = redecoded;
    } catch (_) {}
  }

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
    // Re-decode 3-byte UTF-8 sequences that were stored as raw Latin-1 code points
    // instead of Windows-1252, causing the middle byte to land in the C1 control range
    // (U+0080–U+009F) rather than as a Windows-1252 printable char.
    // Pattern: â (U+00E2 = byte 0xE2) + C1 byte (0x80–0x9F) + continuation (0x80–0xBF)
    // This restores em-dashes (—), en-dashes (–), curly quotes (' ' " "), bullets (•),
    // ellipses, and all other Unicode typographic chars from the U+2000–U+27FF block.
    // Must run BEFORE the C1 strip below, otherwise the middle byte gets erased first.
    .replace(/\u00e2[\u0080-\u009f][\u0080-\u00bf]/g, m => {
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(
          new Uint8Array([0xe2, m.charCodeAt(1), m.charCodeAt(2)])
        );
      } catch (_) { return m; }
    })
    // Strip lone C1 control characters (U+0080–U+009F) that serve no display purpose.
    // Guard: skip if the character is part of a surrogate pair (emoji) — JS strings are
    // UTF-16 so emoji codepoints > U+FFFF are stored as surrogate pairs (U+D800–U+DFFF),
    // not as C1 bytes, so this regex is safe for correctly-decoded emoji.
    .replace(/[\u0080-\u009F]/g, '')
    // Strip UTF-8 BOM and zero-width chars
    .replace(/\uFEFF/g, '')
    .replace(/ï»¿/g, '')              // BOM rendered as mojibake
    .replace(/\u200B|\u200C|\u200D/g, '');
}

function closeModal() {
  _popModalHistory();
  document.getElementById('email-modal').classList.remove('show');
  document.body.style.overflow = '';
  currentViewIndex = -1;
  _isSourceView = false;
  _updateSourceBtn(false);
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

  // Server-side delete (KV + R2 attachments)
  if (email._key) {
    try {
      const params = new URLSearchParams({ key: email._key, address: email.to || currentEmail });
      // Attach any R2 attachment keys for cleanup
      if (email.attachments) {
        email.attachments.forEach(att => {
          if (att.r2Key) params.append('r2key', att.r2Key);
        });
      }
      const res = await fetch(`/api/delete?${params}`, { method: 'DELETE' });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error('Server delete failed:', errData.error || res.status);
        showToast('❌ Could not delete from server');
        return; // Don't remove from local list if server delete failed
      }
    } catch (e) {
      console.error('Server delete failed:', e);
      showToast('❌ Delete failed — check connection');
      return;
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

// ===== Source Toggle =====
function _updateSourceBtn(isSource) {
  const btn = document.getElementById('source-toggle-btn');
  if (btn) {
    btn.textContent = isSource ? 'Email' : 'Source';
    btn.title = isSource ? 'Return to email view' : 'View raw source';
    btn.classList.toggle('active', isSource);
  }
}

function viewSource() {
  if (currentViewIndex < 0) return;
  const email = emailsList[currentViewIndex];
  if (!email) return;

  if (_isSourceView) {
    // Toggle back to normal email view
    _isSourceView = false;
    _updateSourceBtn(false);
    viewEmail(currentViewIndex);
    return;
  }

  _isSourceView = true;
  _updateSourceBtn(true);

  const source = email.rawSource || email.htmlBody || email.body || 'No source';
  const body = document.getElementById('modal-body');

  body.innerHTML = `
    <div class="source-view-wrap">
      <div class="source-view-toolbar">
        <span class="source-view-label">Raw Source</span>
        <button class="source-copy-btn" id="source-copy-btn">📋 Copy</button>
      </div>
      <pre class="source-code-block" id="source-code-pre">${escapeHtml(source)}</pre>
    </div>`;

  document.getElementById('source-copy-btn').addEventListener('click', () => {
    const preEl = document.getElementById('source-code-pre');
    const text = preEl ? preEl.textContent : '';
    const btn = document.getElementById('source-copy-btn');
    navigator.clipboard.writeText(text).then(() => {
      if (btn) { btn.textContent = '✅ Copied!'; setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000); }
    }).catch(() => {
      if (btn) { btn.textContent = '⚠️ Copy failed'; setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000); }
    });
  });
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

// ===== Attachment Lightbox =====
function openAttLightbox(src, filename, type) {
  const lb = document.getElementById('att-lightbox');
  const content = document.getElementById('att-lb-content');
  const nameEl = document.getElementById('att-lb-filename');
  if (!lb || !content) return;

  const ext = (filename || '').split('.').pop().toLowerCase();
  const imageExts = ['jpg','jpeg','png','gif','webp','svg','bmp','ico','avif'];
  const videoExts = ['mp4','webm','ogv','mov'];
  const audioExts = ['mp3','wav','ogg','m4a','flac','aac'];

  content.innerHTML = '';

  if (imageExts.includes(ext)) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = filename;
    img.style.cssText = 'max-width:90vw;max-height:85vh;object-fit:contain;border-radius:8px;';
    content.appendChild(img);

  } else if (ext === 'pdf') {
    const iframe = document.createElement('iframe');
    iframe.src = src;
    iframe.style.cssText = 'width:88vw;height:85vh;border:none;border-radius:8px;background:#fff;';
    iframe.title = filename;
    content.appendChild(iframe);

  } else if (videoExts.includes(ext)) {
    const video = document.createElement('video');
    video.controls = true;
    video.autoplay = false;
    video.style.cssText = 'max-width:90vw;max-height:85vh;border-radius:8px;background:#000;';
    const source = document.createElement('source');
    source.src = src;
    source.type = type || 'video/mp4';
    video.appendChild(source);
    content.appendChild(video);

  } else if (audioExts.includes(ext)) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.style.cssText = 'width:80vw;margin:40px auto;display:block;';
    const source = document.createElement('source');
    source.src = src;
    audio.appendChild(source);
    content.appendChild(audio);

  } else {
    content.innerHTML = `
      <div style="text-align:center;color:#fff;padding:40px;">
        <div style="font-size:64px;margin-bottom:16px;">${getFileIcon(filename)}</div>
        <div style="font-size:18px;margin-bottom:24px;">${escapeHtml(filename)}</div>
        <a href="${src}" download="${escapeHtml(filename)}"
           style="background:#00d09c;color:#000;padding:12px 28px;border-radius:8px;
                  text-decoration:none;font-weight:600;">⬇ Download</a>
      </div>`;
  }

  if (nameEl) nameEl.textContent = filename || '';
  _pushModalHistory();
  lb.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeAttLightbox() {
  _popModalHistory();
  const lb = document.getElementById('att-lightbox');
  if (lb) lb.classList.remove('show');
  document.body.style.overflow = '';
  // Stop any playing media
  document.querySelectorAll('#att-lb-content video, #att-lb-content audio')
    .forEach(el => { el.pause(); el.src = ''; });
}

// ===== Auto Refresh (Visibility-Aware) =====
function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshInterval = setInterval(() => {
    if (!document.hidden) refreshEmails();
  }, 6000);
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
  const username  = localStorage.getItem('username');
  const isPremium = localStorage.getItem('isPremium') === 'true';
  const photoURL  = localStorage.getItem('photoURL');
  const section   = document.getElementById('auth-status-section');
  const statusText = document.getElementById('auth-status-text');
  const actionBtn  = document.getElementById('auth-action-btn');
  const premBtn    = document.getElementById('premium-header-btn');
  const mobileAccountHeaderBtn = document.getElementById('mobile-account-header-btn');
  const avatarEl       = document.getElementById('user-avatar');
  const mobileSigninRow = document.getElementById('mobile-signin-row');
  if (!section) return;

  if (username) {
    // Hide old separate avatar & status text — everything lives in the button now
    if (avatarEl) { avatarEl.classList.add('hidden'); avatarEl.classList.remove('premium-avatar'); }
    if (statusText) statusText.textContent = '';

    // Build inner HTML: small circular avatar + truncated username
    const displayName = username.length > 15 ? username.slice(0, 14) + '…' : username;
    const avatarHtml = photoURL
      ? `<img class="btn-avatar" src="${escapeHtml(photoURL)}" alt="" onerror="this.remove()">`
      : `<span class="btn-avatar-initial">${escapeHtml(username.charAt(0).toUpperCase())}</span>`;
    actionBtn.innerHTML = `${avatarHtml}<span class="btn-username">${escapeHtml(displayName)}</span>`;

    // Apply green (free) or yellow (premium) border class
    actionBtn.classList.remove('signout-btn', 'user-free', 'user-premium');
    actionBtn.classList.add(isPremium ? 'user-premium' : 'user-free');
    actionBtn.onclick = openProfile;

    // Mobile header: show Account button, hide sign-in row
    if (mobileAccountHeaderBtn) {
      mobileAccountHeaderBtn.textContent = username.length > 12 ? username.slice(0, 11) + '…' : username;
      mobileAccountHeaderBtn.classList.remove('hidden');
    }
    if (mobileSigninRow) mobileSigninRow.classList.add('hidden');

    // Hide the Premium button once logged in
    if (premBtn) premBtn.classList.add('hidden');

    updatePremiumDashboard(username, isPremium);
    refreshPremiumStatus();
  } else {
    if (avatarEl) { avatarEl.classList.add('hidden'); avatarEl.classList.remove('premium-avatar'); }
    if (statusText) statusText.textContent = '';

    actionBtn.innerHTML = SIGN_IN_BTN_HTML;
    actionBtn.classList.remove('signout-btn', 'user-free', 'user-premium');
    actionBtn.onclick = openAuth;

    if (mobileAccountHeaderBtn) mobileAccountHeaderBtn.classList.add('hidden');
    if (mobileSigninRow) mobileSigninRow.classList.remove('hidden');

    if (premBtn) {
      premBtn.classList.remove('hidden');
      premBtn.innerHTML = '<i class="purple-star" aria-hidden="true">★</i> Premium';
    }

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

  dash.classList.remove('hidden');
  document.getElementById('pdash-username').textContent = `@${username}`;

  // Update title based on tier
  const titleEl = dash.querySelector('.pdash-title');
  if (titleEl) titleEl.textContent = isPremium ? '⭐ Premium Dashboard' : '🔌 Developer Dashboard';

  // Show/hide premium-only tabs (saved=index 0, forwarding=index 1)
  const tabs = dash.querySelectorAll('.pdash-tab');
  if (tabs[0]) tabs[0].classList.toggle('hidden', !isPremium);
  if (tabs[1]) tabs[1].classList.toggle('hidden', !isPremium);

  // Default active tab
  switchPDashTab(isPremium ? 'saved' : 'apikey');

  loadApiKey();
  if (isPremium) loadSavedEmails();
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
    _pushModalHistory();
  } else {
    doSignOut();
  }
}

function closeSignOutConfirm() {
  _popModalHistory();
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
  _pushModalHistory();
}

function closeAuth() {
  _popModalHistory();
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
  _pushModalHistory();
}
function closeAbout() {
  _popModalHistory();
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
  _pushModalHistory();
  await loadProfileData();
}

function closeProfile() {
  _popModalHistory();
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
  _pushModalHistory();
}

function closePremiumRequiredPrompt() {
  _popModalHistory();
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

// ===== History API: Back-Button Modal Navigation =====
// Pushing a history state for each modal open so the browser back button
// closes the modal instead of navigating away from the page.
let _modalHistoryDepth = 0;
let _handlingPopstate = false;

function _pushModalHistory() {
  _modalHistoryDepth++;
  history.pushState({ phantomModal: true }, '');
}

function _popModalHistory() {
  if (_modalHistoryDepth <= 0) return;
  if (_handlingPopstate) return; // History already moved by the back button
  _modalHistoryDepth--;
  _handlingPopstate = true;
  // history.back() fires popstate asynchronously; the flag prevents the handler
  // from treating this programmatic navigation as a user back-press.
  // Safety: reset the flag after 500 ms in case history.back() never fires
  // (e.g. already at the beginning of the session history).
  setTimeout(() => { _handlingPopstate = false; }, 500);
  history.back();
}

function _closeTopmostModal() {
  const lb = document.getElementById('att-lightbox');
  if (lb && lb.classList.contains('show')) { closeAttLightbox(); return; }
  const em = document.getElementById('email-modal');
  if (em && em.classList.contains('show')) { closeModal(); return; }
  const premReq = document.getElementById('premium-required-modal');
  if (premReq && premReq.classList.contains('show')) { closePremiumRequiredPrompt(); return; }
  const signout = document.getElementById('signout-confirm-modal');
  if (signout && signout.classList.contains('show')) { closeSignOutConfirm(); return; }
  const auth = document.getElementById('auth-modal');
  if (auth && auth.classList.contains('show')) { closeAuth(); return; }
  const profile = document.getElementById('profile-modal');
  if (profile && profile.classList.contains('show')) { closeProfile(); return; }
  const about = document.getElementById('about-modal');
  if (about && about.classList.contains('show')) { closeAbout(); return; }
  const qr = document.getElementById('qr-modal');
  if (qr && qr.classList.contains('show')) { closeQR(); return; }
  const compose = document.getElementById('compose-modal');
  if (compose && compose.classList.contains('show')) { closeCompose(); return; }
}

window.addEventListener('popstate', () => {
  if (_handlingPopstate) { _handlingPopstate = false; return; }
  _handlingPopstate = true;
  if (_modalHistoryDepth > 0) _modalHistoryDepth--;
  _closeTopmostModal();
  _handlingPopstate = false;
});

// ===== Global Key/Click Listeners =====
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal(); closeAbout(); closeQR(); closePremiumFlow(); closeAuth(); closeProfile(); closeAttLightbox(); closeCompose();
    closeSignOutConfirm(); closePremiumRequiredPrompt();
  }
});

// Re-position compose window on resize so it never goes off-screen
window.addEventListener('resize', () => {
  const win = document.getElementById('compose-modal');
  if (!win || !win.classList.contains('show') || _composeFullscreen) return;
  // Only nudge when the window is already using top/left (i.e. dragging class is set)
  if (!win.classList.contains('dragging')) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const winW = win.offsetWidth;
  const curLeft = parseFloat(win.style.getPropertyValue('left')) || 0;
  const curTop = parseFloat(win.style.getPropertyValue('top')) || 0;
  const clampedLeft = Math.max(8, Math.min(vw - winW - 8, curLeft));
  const clampedTop = Math.max(8, Math.min(vh - 56, curTop));
  if (clampedLeft !== curLeft) win.style.setProperty('left', `${clampedLeft}px`, 'important');
  if (clampedTop !== curTop) win.style.setProperty('top', `${clampedTop}px`, 'important');
});

document.getElementById('email-modal')?.addEventListener('click', e => { if (e.target.id === 'email-modal') closeModal(); });
document.getElementById('about-modal')?.addEventListener('click', e => { if (e.target.id === 'about-modal') closeAbout(); });
document.getElementById('qr-modal')?.addEventListener('click', e => { if (e.target.id === 'qr-modal') closeQR(); });
document.getElementById('auth-modal')?.addEventListener('click', e => { if (e.target.id === 'auth-modal') closeAuth(); });
document.getElementById('profile-modal')?.addEventListener('click', e => { if (e.target.id === 'profile-modal') closeProfile(); });

// Initialize auth state on load
document.addEventListener('DOMContentLoaded', initAuthState);

// ===== COMPOSE: State =====
// (composeMinimized, composeIsHtml, sentList, sentBoxOpen declared at top of file)
let _composeFullscreen = false;

// ===== COMPOSE: Open =====
function openCompose() {
  const win = document.getElementById('compose-modal');
  if (!win) return;

  // If already open and minimized — just un-minimize
  if (win.classList.contains('show') && win.classList.contains('minimized')) {
    win.classList.remove('minimized');
    composeMinimized = false;
    setTimeout(() => document.getElementById('compose-to').focus(), 80);
    return;
  }

  // ── Show window IMMEDIATELY (no awaiting anything) ──────────
  document.getElementById('compose-to').value = '';
  document.getElementById('compose-subject').value = '';
  document.getElementById('compose-editor').innerHTML = '';
  document.getElementById('compose-textarea').value = '';
  document.getElementById('compose-error').classList.add('hidden');

  // Reset attachments
  composeAttachments = [];
  renderComposeAttachments();

  // Reset custom-from
  const customFromWrap = document.getElementById('compose-custom-from-wrap');
  const customFromInput = document.getElementById('compose-custom-username');
  const fromSelect = document.getElementById('compose-from');
  if (customFromWrap) customFromWrap.classList.add('hidden');
  if (customFromInput) customFromInput.value = '';
  if (fromSelect) fromSelect.classList.remove('hidden');

  // Reset drag position (clears any previous drag state)
  win.classList.remove('dragging');
  win.style.removeProperty('left');
  win.style.removeProperty('top');

  composeMinimized = false;
  composeIsHtml = true;
  _composeFullscreen = false;
  document.getElementById('compose-editor').classList.remove('hidden');
  document.getElementById('compose-textarea').classList.add('hidden');
  const modeBtn = document.getElementById('compose-mode-btn');
  if (modeBtn) modeBtn.querySelector('span').textContent = 'HTML';
  win.classList.remove('minimized', 'fullscreen');
  // Force display via inline style so it always works regardless of CSS cascade
  win.style.display = 'flex';
  win.classList.add('show');
  const fab = document.getElementById('compose-fab');
  if (fab) fab.style.display = 'none';
  _pushModalHistory();

  // Apply smart initial position on desktop (after the element is visible so
  // the browser has laid it out and we can read its dimensions)
  requestAnimationFrame(() => _setComposeInitialPosition(win));

  setTimeout(() => document.getElementById('compose-to').focus(), 80);

  // ── Init drag once ────────────────────────────────────────────
  _initComposeDrag();

  // ── Populate From dropdown asynchronously (non-blocking) ────
  _populateComposeFrom();
}

async function _populateComposeFrom() {
  const fromSelect = document.getElementById('compose-from');
  if (!fromSelect) return;
  fromSelect.innerHTML = '';
  if (currentEmail) {
    const opt = document.createElement('option');
    opt.value = currentEmail;
    opt.textContent = currentEmail;
    fromSelect.appendChild(opt);
  }

  const token = localStorage.getItem('authToken');
  const isPremium = localStorage.getItem('isPremium') === 'true';

  // Show pencil button for EVERYONE (non-premium gets a premium prompt when they click)
  const customFromBtn = document.getElementById('compose-custom-from-btn');
  if (customFromBtn) customFromBtn.classList.remove('hidden');

  // Fetch real remaining count from server
  const rl = document.getElementById('compose-ratelimit');
  if (rl) {
    rl.textContent = isPremium ? '⭐ 50/day' : '3/day free'; // initial placeholder
    try {
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
      const limitUrl = token
        ? '/api/send'
        : currentEmail
          ? `/api/send?address=${encodeURIComponent(currentEmail)}`
          : null;
      if (limitUrl) {
        const res = await fetch(limitUrl, { headers });
        const data = await res.json();
        if (typeof data.remaining === 'number') {
          const icon = data.isPremium ? '⭐' : '📨';
          rl.textContent = `${icon} ${data.remaining}/${data.limit} left today`;
        }
      }
    } catch (_) {}
  }

  if (token && isPremium) {
    try {
      const res = await fetch('/api/user/saved-emails', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      (data.savedEmails || []).forEach(e => {
        if (e.address !== currentEmail) {
          const opt = document.createElement('option');
          opt.value = e.address;
          opt.textContent = e.address;
          fromSelect.appendChild(opt);
        }
      });
    } catch (_) {}
  }
}

// ===== COMPOSE: Close =====
function closeCompose() {
  _popModalHistory();
  const fab = document.getElementById('compose-fab');
  if (fab) fab.style.removeProperty('display');
  const win = document.getElementById('compose-modal');
  if (!win) return;
  win.style.display = 'none'; // clear the inline style set by openCompose
  win.classList.remove('show', 'minimized', 'fullscreen', 'dragging');
  win.style.removeProperty('left');
  win.style.removeProperty('top');
  composeMinimized = false;
  _composeFullscreen = false;
  _composeDragActive = false;
}

// ===== COMPOSE: Smart initial position (desktop only) =====
// Calculates the best place to open the compose window based on the viewport's
// width/height ratio so it never feels crammed in a corner on large displays.
function _setComposeInitialPosition(win) {
  if (!win) return;
  if (window.innerWidth <= 560) return; // mobile: CSS bottom-sheet handles it

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const ratio = vw / vh;

  // Actual rendered dimensions (fall back to CSS defaults if not yet known)
  const winW = win.offsetWidth  || Math.min(460, vw - 32);
  const winH = win.offsetHeight || Math.min(540, vh * 0.92);

  // --- Right margin: scales gently with screen width, capped at 60px ---
  // On a 1366px screen → ~24px; on a 1920px screen → ~29px; on 2560px → ~46px
  const rightMargin = Math.round(Math.max(24, Math.min(vw * 0.018, 60)));

  // --- Bottom clearance: let portrait/square-ish screens breathe a little ---
  // Standard landscape (ratio ≥ 1.5) → sit flush at the bottom
  // Near-square / portrait → float up slightly
  // Portrait/square (ratio < 1.4) → float up 4 % of viewport height.
  // Landscape (ratio ≥ 1.4) → leave a small 16 px gap from the bottom edge
  // so the window never appears flush against the taskbar / safe area.
  const bottomClearance = ratio < 1.4 ? Math.round(vh * 0.04) : 16;

  // Base position: bottom-right with adaptive margins
  let left = vw - winW - rightMargin;
  let top  = vh - winH - bottomClearance;

  // Ultra-wide (21:9+, ratio ≥ 2.1): pull a bit further inward from the edge
  if (ratio >= 2.1) {
    left = vw - winW - Math.round(Math.min(vw * 0.03, 80));
  }

  // Clamp strictly inside viewport so no part of the window goes off-screen
  left = Math.max(8, Math.min(vw - winW - 8, left));
  top  = Math.max(8, Math.min(vh - 56, top));

  // Switch the window to top/left anchoring (the .dragging class un-sets
  // the CSS `bottom !important` and `right !important` rules)
  win.classList.add('dragging');
  win.style.setProperty('left', `${Math.round(left)}px`, 'important');
  win.style.setProperty('top',  `${Math.round(top)}px`,  'important');
}

// ===== COMPOSE: Drag (desktop only) =====
function _initComposeDrag() {
  if (_composeDragInited) return;
  _composeDragInited = true;

  const win = document.getElementById('compose-modal');
  const header = win ? win.querySelector('.cw-header') : null;
  if (!header) return;

  header.addEventListener('mousedown', (e) => {
    // Don't drag when clicking control buttons or on small/mobile screens
    if (e.target.closest('.cw-controls')) return;
    if (_composeFullscreen) return;
    if (window.innerWidth <= 560) return;

    e.preventDefault();
    const rect = win.getBoundingClientRect();
    _composeDragWinX = rect.left;
    _composeDragWinY = rect.top;
    _composeDragStartX = e.clientX;
    _composeDragStartY = e.clientY;
    _composeDragActive = true;

    // Switch from bottom/right anchoring to top/left so we can move freely
    win.classList.add('dragging');
    win.style.setProperty('left', `${rect.left}px`, 'important');
    win.style.setProperty('top', `${rect.top}px`, 'important');
    header.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', (e) => {
    if (!_composeDragActive) return;
    const win2 = document.getElementById('compose-modal');
    if (!win2) return;
    const dx = e.clientX - _composeDragStartX;
    const dy = e.clientY - _composeDragStartY;
    const newX = Math.max(0, Math.min(window.innerWidth - win2.offsetWidth, _composeDragWinX + dx));
    const newY = Math.max(0, Math.min(window.innerHeight - 48, _composeDragWinY + dy));
    win2.style.setProperty('left', `${newX}px`, 'important');
    win2.style.setProperty('top', `${newY}px`, 'important');
  });

  document.addEventListener('mouseup', () => {
    if (!_composeDragActive) return;
    _composeDragActive = false;
    const hdr = document.querySelector('#compose-modal .cw-header');
    if (hdr) hdr.style.cursor = '';
  });
}

// ===== COMPOSE: Premium custom sender =====
function toggleCustomFrom() {
  const isPremium = localStorage.getItem('isPremium') === 'true';
  const token = localStorage.getItem('authToken');
  if (!isPremium) {
    const msg = token
      ? '⭐ Upgrade to Premium to use a custom sender username.'
      : '🔐 Sign in and upgrade to Premium to use a custom sender username.';
    showPremiumRequiredPrompt(msg);
    return;
  }
  const wrap = document.getElementById('compose-custom-from-wrap');
  const sel = document.getElementById('compose-from');
  if (!wrap || !sel) return;
  const isShowing = !wrap.classList.contains('hidden');
  if (isShowing) {
    wrap.classList.add('hidden');
    sel.classList.remove('hidden');
  } else {
    wrap.classList.remove('hidden');
    sel.classList.add('hidden');
    const inp = document.getElementById('compose-custom-username');
    if (inp) inp.focus();
  }
}

// ===== COMPOSE: Attachments =====
async function addComposeAttachments(input) {
  const MAX_TOTAL = 10 * 1024 * 1024; // 10 MB total (raw bytes)
  const files = Array.from(input.files);
  for (const file of files) {
    const currentTotal = composeAttachments.reduce((s, a) => s + a.size, 0);
    if (currentTotal + file.size > MAX_TOTAL) {
      showToast(`❌ Total attachments exceed ${MAX_TOTAL / (1024 * 1024)} MB limit`);
      break;
    }
    const content = await _readFileBase64(file);
    composeAttachments.push({ filename: file.name, content, size: file.size, type: file.type });
  }
  renderComposeAttachments();
  input.value = ''; // reset so the same file can be re-attached
}

function _readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function removeComposeAttachment(index) {
  composeAttachments.splice(index, 1);
  renderComposeAttachments();
}

function renderComposeAttachments() {
  const el = document.getElementById('compose-attach-list');
  if (!el) return;
  if (composeAttachments.length === 0) {
    el.innerHTML = '';
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = composeAttachments.map((a, i) => `
    <div class="cw-attach-chip">
      <span class="cw-attach-icon">📎</span>
      <span class="cw-attach-name" title="${escapeHtml(a.filename)}">${escapeHtml(a.filename)}</span>
      <span class="cw-attach-size">${_fmtFileSize(a.size)}</span>
      <button class="cw-attach-remove" onclick="removeComposeAttachment(${i})" title="Remove attachment">✕</button>
    </div>`).join('');
}

function _fmtFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ===== COMPOSE: Minimize / restore on header click =====
function toggleComposeMinimize() {
  const win = document.getElementById('compose-modal');
  if (!win) return;
  composeMinimized = !composeMinimized;
  win.classList.toggle('minimized', composeMinimized);
}

// ===== COMPOSE: Full-screen expand =====
function expandComposeFullscreen() {
  const win = document.getElementById('compose-modal');
  if (!win) return;
  _composeFullscreen = !_composeFullscreen;
  win.classList.toggle('fullscreen', _composeFullscreen);
  win.classList.remove('minimized');
  composeMinimized = false;

  // When leaving fullscreen, re-apply the smart initial position so the window
  // lands back at the calculated sweet-spot rather than snapping to CSS defaults.
  if (!_composeFullscreen) {
    win.classList.remove('dragging');
    win.style.removeProperty('left');
    win.style.removeProperty('top');
    requestAnimationFrame(() => _setComposeInitialPosition(win));
  }
}

// ===== COMPOSE: Toggle HTML / Plain Text =====
function toggleComposeMode() {
  composeIsHtml = !composeIsHtml;
  const editor = document.getElementById('compose-editor');
  const textarea = document.getElementById('compose-textarea');
  const btn = document.getElementById('compose-mode-btn');

  if (composeIsHtml) {
    editor.innerHTML = (textarea.value || '').replace(/\n/g, '<br>');
    editor.classList.remove('hidden');
    textarea.classList.add('hidden');
    if (btn) btn.querySelector('span').textContent = 'HTML';
  } else {
    textarea.value = editor.innerText || '';
    editor.classList.add('hidden');
    textarea.classList.remove('hidden');
    if (btn) btn.querySelector('span').textContent = 'TXT';
  }
}

// ===== COMPOSE: Formatting =====
function composeFormat(cmd) {
  document.getElementById('compose-editor').focus();
  document.execCommand(cmd, false, null);
}

function composeInsertLink() {
  const url = prompt('Enter URL:');
  if (url) {
    document.getElementById('compose-editor').focus();
    document.execCommand('createLink', false, url);
  }
}

// ===== COMPOSE: Send =====
async function sendComposedEmail() {
  // Resolve "from" — prefer custom address if premium toggle is active
  let from = document.getElementById('compose-from').value;
  const customFromWrap = document.getElementById('compose-custom-from-wrap');
  if (customFromWrap && !customFromWrap.classList.contains('hidden')) {
    const customUsername = (document.getElementById('compose-custom-username').value || '').trim();
    if (customUsername) {
      // Only allow safe characters; reject leading/trailing dots and consecutive dots
      if (
        !/^[a-zA-Z0-9._+-]+$/.test(customUsername) ||
        customUsername.startsWith('.') ||
        customUsername.endsWith('.') ||
        customUsername.includes('..')
      ) {
        const errEl = document.getElementById('compose-error');
        errEl.textContent = 'Username may only contain letters, numbers, dots, underscores, plus and hyphens — no leading/trailing/consecutive dots';
        errEl.classList.remove('hidden');
        return;
      }
      from = `${customUsername}@unknownlll2829.qzz.io`;
    }
  }

  const to = document.getElementById('compose-to').value.trim();
  const subject = document.getElementById('compose-subject').value.trim();
  const body = composeIsHtml
    ? document.getElementById('compose-editor').innerHTML
    : document.getElementById('compose-textarea').value;
  const errEl = document.getElementById('compose-error');
  const sendBtn = document.getElementById('compose-send-btn');
  const sendLabel = document.getElementById('compose-send-label');

  errEl.classList.add('hidden');

  if (!to || !to.includes('@')) {
    errEl.textContent = 'Enter a valid recipient email';
    errEl.classList.remove('hidden');
    return;
  }
  if (!subject) {
    errEl.textContent = 'Subject is required';
    errEl.classList.remove('hidden');
    return;
  }
  if (!body || body.replace(/<[^>]*>/g, '').trim().length === 0) {
    errEl.textContent = 'Message body is empty';
    errEl.classList.remove('hidden');
    return;
  }

  sendBtn.disabled = true;
  sendLabel.textContent = 'Sending…';

  try {
    const token = localStorage.getItem('authToken');
    const payload = {
      from, to, subject, body, isHtml: composeIsHtml,
      ...(composeAttachments.length > 0 && {
        attachments: composeAttachments.map(a => ({ filename: a.filename, content: a.content }))
      })
    };
    const res = await fetch('/api/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (res.ok) {
      showToast('📤 Email sent!');
      closeCompose();
      setTimeout(() => loadSentEmails(), 500);
    } else {
      errEl.textContent = data.error || 'Failed to send';
      errEl.classList.remove('hidden');
    }
  } catch (e) {
    errEl.textContent = 'Network error — try again';
    errEl.classList.remove('hidden');
  } finally {
    sendBtn.disabled = false;
    sendLabel.textContent = 'Send';
  }
}

// ===== SENT BOX: Load =====
async function loadSentEmails() {
  const wrapper = document.getElementById('sent-box-wrapper');
  const badge = document.getElementById('sent-count-badge');
  if (wrapper) wrapper.classList.remove('hidden');

  try {
    const token = localStorage.getItem('authToken');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    // For authenticated users, server returns all sent emails via sentidx lookup.
    // For anonymous, fall back to address-based lookup.
    const url = token
      ? '/api/sent'
      : currentEmail ? `/api/sent?address=${encodeURIComponent(currentEmail)}` : null;

    if (!url) { sentList = []; if (sentBoxOpen) renderSentBox(); return; }

    const res = await fetch(url, { headers });
    const data = await res.json();
    sentList = data.sent || [];

    if (badge) badge.textContent = sentList.length;
    if (sentBoxOpen) renderSentBox();
  } catch (_) {
    sentList = [];
    if (sentBoxOpen) renderSentBox();
  }
}

// ===== SENT BOX: Toggle =====
function toggleSentBox() {
  sentBoxOpen = !sentBoxOpen;
  const body = document.getElementById('sent-box-body');
  const toggle = document.getElementById('sent-box-toggle');
  if (body) body.classList.toggle('hidden', !sentBoxOpen);
  if (toggle) toggle.textContent = sentBoxOpen ? '▴' : '▾';
  if (sentBoxOpen) renderSentBox();
}

// ===== SENT BOX: Render =====
function renderSentBox() {
  const body = document.getElementById('sent-box-body');
  if (!body) return;

  if (sentList.length === 0) {
    body.innerHTML = '<div class="sent-empty">No sent emails</div>';
    return;
  }

  body.innerHTML = sentList.map((s, i) => {
    const opens = s.opens || 0;
    const toStr = Array.isArray(s.to) ? s.to.join(', ') : s.to;
    const dateStr = formatDate(s.sentAt);
    const openBadge = opens > 0
      ? `<span class="sent-opened-badge">👁 ${opens} open${opens > 1 ? 's' : ''}</span>`
      : `<span class="sent-unopened-badge">Not opened</span>`;
    // Extract plain-text preview safely via DOM (avoids regex-based incomplete sanitization)
    let bodyPreview = '';
    if (s.body) {
      const tmp = document.createElement('div');
      tmp.innerHTML = s.body;
      const plainText = (tmp.textContent || tmp.innerText || '').trim();
      bodyPreview = escapeHtml(plainText.slice(0, 80)) + (plainText.length > 80 ? '…' : '');
    }

    return `
      <div class="sent-row">
        <div class="sent-row-main" onclick="viewSentEmail(${i})" style="cursor:pointer;">
          <div class="sent-from-to">
            <span class="sent-from-label">From: ${escapeHtml(s.from || '')}</span>
            <span class="sent-to-label">To: ${escapeHtml(toStr)}</span>
          </div>
          <div class="sent-subject">${escapeHtml(s.subject)}</div>
          ${bodyPreview ? `<div class="sent-body-preview">${bodyPreview}</div>` : ''}
        </div>
        <div class="sent-row-meta">
          ${openBadge}
          <div class="sent-date">${dateStr}</div>
          <button class="sent-delete-btn" onclick="deleteSentEmail(event,${i})" title="Delete this sent email">🗑</button>
        </div>
      </div>`;
  }).join('');
}

// ===== SENT BOX: Delete a sent email =====
async function deleteSentEmail(event, index) {
  event.stopPropagation();
  const s = sentList[index];
  if (!s || !s._kvKey) return;
  if (!confirm('Delete this sent email?')) return;
  try {
    const token = localStorage.getItem('authToken');
    const params = new URLSearchParams({ key: s._kvKey });
    if (s._idxKey) params.set('idxKey', s._idxKey);
    if (!token && currentEmail) params.set('address', currentEmail);
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const res = await fetch(`/api/sent?${params}`, { method: 'DELETE', headers });
    const data = await res.json();
    if (data.success) {
      sentList.splice(index, 1);
      const badge = document.getElementById('sent-count-badge');
      if (badge) badge.textContent = sentList.length;
      renderSentBox();
      showToast('🗑 Sent email deleted');
    } else {
      showToast('❌ ' + (data.error || 'Failed to delete'));
    }
  } catch (_) {
    showToast('❌ Network error');
  }
}

// ===== SENT BOX: View sent email with analytics =====
function viewSentEmail(index) {
  const s = sentList[index];
  if (!s) return;

  const toStr = Array.isArray(s.to) ? s.to.join(', ') : s.to;
  const opens = s.opens || 0;
  const lastOpen = s.lastOpenAt ? formatDate(s.lastOpenAt) : 'Never';
  const country = s.lastOpenCountry || '—';

  document.getElementById('modal-avatar').textContent = '📤';
  document.getElementById('modal-sender-name').textContent = 'Sent Email';
  document.getElementById('modal-sender-email').textContent = s.from;
  document.getElementById('modal-date').textContent = formatDate(s.sentAt);
  document.getElementById('modal-subject').textContent = s.subject;

  // Render email body for display
  let bodyHtml = '';
  if (s.body) {
    if (s.isHtml) {
      bodyHtml = `
        <div class="sent-email-body-section">
          <h4>📧 Email Content</h4>
          <iframe class="sent-email-iframe" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            srcdoc="${escapeHtml(s.body)}" title="Sent email content"></iframe>
        </div>`;
    } else {
      bodyHtml = `
        <div class="sent-email-body-section">
          <h4>📧 Email Content</h4>
          <pre class="sent-email-plaintext">${escapeHtml(s.body)}</pre>
        </div>`;
    }
  }

  const toStr2 = Array.isArray(s.to) ? s.to.join(', ') : s.to;
  const body = document.getElementById('modal-body');
  body.innerHTML = `
    <div class="sent-mail-meta-card">
      <div class="smm-row"><span class="smm-label">From</span><span class="smm-value">${escapeHtml(s.from || '')}</span></div>
      <div class="smm-row"><span class="smm-label">To</span><span class="smm-value">${escapeHtml(toStr2)}</span></div>
      <div class="smm-row"><span class="smm-label">Date</span><span class="smm-value">${formatDate(s.sentAt)}</span></div>
    </div>
    ${bodyHtml}
    <div class="sent-analytics-card" style="margin-top:20px;">
      <h4>📊 Delivery Analytics</h4>
      <div class="analytics-grid">
        <div class="analytics-item">
          <div class="analytics-value ${opens > 0 ? 'green' : ''}">${opens}</div>
          <div class="analytics-label">Opens</div>
        </div>
        <div class="analytics-item">
          <div class="analytics-value">${lastOpen}</div>
          <div class="analytics-label">Last Opened</div>
        </div>
        <div class="analytics-item">
          <div class="analytics-value">${country}</div>
          <div class="analytics-label">Location</div>
        </div>
        <div class="analytics-item">
          <div class="analytics-value">${opens > 0 ? '✅' : '⏳'}</div>
          <div class="analytics-label">Status</div>
        </div>
      </div>
      ${s.openHistory && s.openHistory.length > 0 ? `
        <h4 style="margin-top:16px;">Open History</h4>
        <div class="open-history">
          ${s.openHistory.slice(0, 5).map(h => `
            <div class="open-history-item">
              <span>${formatDate(h.at)}</span>
              <span>${h.country || '—'}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>`;

  document.getElementById('modal-attachments').classList.add('hidden');
  _pushModalHistory();
  document.getElementById('email-modal').classList.add('show');
  document.body.style.overflow = 'hidden';
}
