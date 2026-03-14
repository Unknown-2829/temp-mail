/* Phantom Mail - JavaScript (Optimized) */

/* ===== Cached DOM References ===== */
let $inboxBody, $emailDisplay, $toast, $toastMsg;

let currentEmail = '';
let emailsList = [];
let autoRefreshInterval = null;
let currentViewIndex = -1;
let previousEmailCount = 0;
const originalTitle = document.title;

// Persistent state (loaded once at startup)
let deletedIds = JSON.parse(localStorage.getItem('deletedIds') || '[]');
let readIds = JSON.parse(localStorage.getItem('readIds') || '[]');

// Flags to prevent double-actions
let isGenerating = false;
let renderPending = false;

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
  previousEmailCount = 0;

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
  previousEmailCount = 0;

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
async function refreshEmails() {
  if (!currentEmail) return;

  try {
    const response = await fetch(`/api/emails?address=${encodeURIComponent(currentEmail)}`);
    const data = await response.json();

    const rawEmails = data.emails || [];
    const validEmails = rawEmails.filter(e => !deletedIds.includes(e.id || e.timestamp));

    validEmails.forEach(e => {
      if (readIds.includes(e.id || e.timestamp)) e.read = true;
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
    console.error(e);
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

// ===== Skeleton Loader =====
function showSkeletonLoader(rows = 3) {
  if (!$inboxBody) return;
  let html = '';
  for (let i = 0; i < rows; i++) {
    html += `
      <div class="skeleton-row">
        <div class="skeleton-cell short"></div>
        <div class="skeleton-cell long"></div>
        <div class="skeleton-cell tiny"></div>
      </div>
    `;
  }
  $inboxBody.innerHTML = html;
}

// ===== Parse Sender =====
function parseSender(from, emailObj) {
  if (!from) return { name: 'Unknown', email: '' };

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

  const id = email.id || email.timestamp;
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
    let html = sanitizeHtml(email.htmlBody);
    html = cleanBrokenChars(html);
    body.innerHTML = html;
    body.querySelectorAll('a').forEach(a => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    });
  } else if (email.body) {
    let text = cleanBrokenChars(email.body);
    body.innerHTML = `<div style="white-space:pre-wrap;word-break:break-word;">${linkify(escapeHtml(text))}</div>`;
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

// ===== Clean broken UTF-8 =====
function cleanBrokenChars(text) {
  if (!text) return '';
  return text
    .replace(/Â\s*/g, '')
    .replace(/Ã¢/g, 'â')
    .replace(/Ã©/g, 'é')
    .replace(/â€™/g, "'")
    .replace(/â€"/g, "-")
    .replace(/â€œ/g, '"')
    .replace(/â€/g, '"')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u0080-\u009F]/g, '');
}

function closeModal() {
  document.getElementById('email-modal').classList.remove('show');
  document.body.style.overflow = '';
  currentViewIndex = -1;
}

function deleteCurrentEmail() {
  if (currentViewIndex >= 0) {
    const email = emailsList[currentViewIndex];
    if (email) {
      const id = email.id || email.timestamp;
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
  }
}

function viewSource() {
  if (currentViewIndex >= 0) {
    const email = emailsList[currentViewIndex];
    const source = email.rawSource || email.htmlBody || email.body || 'No source';
    document.getElementById('modal-body').innerHTML =
      `<pre style="background:#f5f5f5;padding:15px;border-radius:8px;overflow-x:auto;font-size:12px;">${escapeHtml(source)}</pre>`;
  }
}

function downloadAttachment(ei, ai) {
  const att = emailsList[ei]?.attachments?.[ai];
  if (!att?.data) { showToast('❌ Not available'); return; }
  try {
    const bytes = atob(att.data);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: att.contentType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = att.filename; a.click();
    URL.revokeObjectURL(url);
    showToast('📥 Downloading...');
  } catch (e) { showToast('❌ Failed'); }
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
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '#')
    .replace(/on\w+\s*=/gi, 'data-x=');
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

function showQR() { toggleQR(); }
function closeQR() {
  document.getElementById('qr-dropdown')?.classList.add('hidden');
  document.getElementById('qr-dropdown-mobile')?.classList.add('hidden');
  qrVisible = false;
}

// ===== Premium Flow Overlay =====
let pfState = { step: 1, plan: 'yearly', price: 20 };

function openPremium() {
  // If already premium, scroll to the dashboard instead
  if (localStorage.getItem('isPremium') === 'true') {
    const dash = document.getElementById('premium-dashboard');
    if (dash) {
      dash.scrollIntoView({ behavior: 'smooth', block: 'start' });
      showToast('⭐ You already have Premium!');
    }
    return;
  }
  document.getElementById('premium-flow-overlay').classList.add('show');
  document.body.style.overflow = 'hidden';
  // If already logged in, skip auth step and go to payment
  if (localStorage.getItem('authToken')) {
    goToPremiumStep(3);
  } else {
    goToPremiumStep(1);
  }
}

function closePremiumFlow() {
  document.getElementById('premium-flow-overlay').classList.remove('show');
  document.body.style.overflow = '';
}

function goToPremiumStep(step) {
  pfState.step = step;

  // Hide all, show target
  [1, 2, 3].forEach(s => {
    document.getElementById(`pf-step-${s}`)?.classList.toggle('hidden', s !== step);
    document.getElementById(`pf-dot-${s}`)?.classList.toggle('active', s === step);
  });

  document.getElementById('pf-back-btn')?.classList.toggle('hidden', step === 1);

  if (step === 3) renderCheckout();
}

function prevPremiumStep() {
  if (pfState.step > 1) goToPremiumStep(pfState.step - 1);
}

function selectPremiumPlan(plan) {
  pfState.plan = plan;
  pfState.price = plan === 'yearly' ? 20 : 3;

  // Add active class
  document.querySelectorAll('.pf-price-card').forEach(c => c.classList.remove('active'));
  document.getElementById(`pf-plan-${plan}`).classList.add('active');
}

function continueFromPlan() {
  if (localStorage.getItem('authToken')) {
    goToPremiumStep(3); // Logged in, go to payment
  } else {
    goToPremiumStep(2); // Needs account
  }
}

// PF Auth (Step 2)
function switchPfAuthTab(tab) {
  const isSignin = tab === 'signin';
  document.getElementById('pf-signin-section').classList.toggle('hidden', !isSignin);
  document.getElementById('pf-signup-section').classList.toggle('hidden', isSignin);
  document.getElementById('pf-tab-signin').classList.toggle('active', isSignin);
  document.getElementById('pf-tab-signup').classList.toggle('active', !isSignin);
  document.getElementById('pf-auth-error').classList.add('hidden');
}

function showPfError(msg) {
  const errEl = document.getElementById('pf-auth-error');
  errEl.textContent = msg;
  errEl.classList.remove('hidden');
}

async function pfSignIn() {
  const username = document.getElementById('pf-signin-username').value.trim();
  const password = document.getElementById('pf-signin-password').value;
  if (!username || !password) return showPfError('Credentials required');

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
      initAuthState();
      showToast('✅ Signed in!');
      goToPremiumStep(3);
    } else {
      showPfError(data.error || 'Sign in failed');
    }
  } catch (e) { showPfError('Network error'); }
}

async function pfSignUp() {
  const username = document.getElementById('pf-signup-username').value.trim();
  const password = document.getElementById('pf-signup-password').value;
  const email = document.getElementById('pf-signup-email').value.trim();
  if (!username || !password) return showPfError('Username and password required');

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
      initAuthState();
      showToast('🎉 Account created!');
      goToPremiumStep(3);
    } else {
      showPfError(data.error || 'Signup failed');
    }
  } catch (e) { showPfError('Network error'); }
}

// PF Checkout (Step 3)
const cryptoAddrs = {
  btc: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
  eth: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
  sol: 'HN7cABqLq46Es1jh92dQQisAq662SmxELLTPRdnQdYvS'
};
const cryptoNets = {
  btc: 'Bitcoin (BTC)',
  eth: 'ERC20, BEP20, Polygon, Arbitrum, Optimism',
  sol: 'Solana (SOL)'
};

function renderCheckout() {
  const planName = pfState.plan === 'yearly' ? 'Yearly Premium ($20)' : 'Monthly Premium ($3)';
  document.getElementById('pf-selected-plan-name').textContent = planName;
  document.getElementById('pf-pay-amount').textContent = `$${pfState.price}`;

  const telegramUrl = `https://t.me/unknownlll2829?text=Hello, I want to activate ${pfState.plan} Premium for username: ${localStorage.getItem('username')}. Tx hash: `;
  document.getElementById('pf-telegram-link').href = telegramUrl;
}

function showCryptoAddress(coin) {
  document.querySelectorAll('.pf-crypto-btn').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.toLowerCase().includes(coin.substring(0, 3)));
  });

  document.getElementById('pf-crypto-address-target').textContent = cryptoAddrs[coin];
  document.getElementById('pf-crypto-network-hint').textContent = `Network: ${cryptoNets[coin]}`;
}

function copyCrypto(id) {
  const code = document.getElementById(id);
  if (!code) return;
  navigator.clipboard.writeText(code.textContent)
    .then(() => showToast('📋 Address copied!'))
    .catch(() => showToast('❌ Copy failed'));
}

// ===== Auth State =====
function initAuthState() {
  const username = localStorage.getItem('username');
  const isPremium = localStorage.getItem('isPremium') === 'true';
  const section = document.getElementById('auth-status-section');
  const statusText = document.getElementById('auth-status-text');
  const actionBtn = document.getElementById('auth-action-btn');
  const premBtn = document.getElementById('premium-header-btn');
  if (!section) return;

  if (username) {
    statusText.textContent = isPremium
      ? `⭐ @${username}`
      : `👤 @${username}`;
    actionBtn.textContent = 'Logout';
    actionBtn.classList.add('signout-btn');
    actionBtn.onclick = signOut;

    // Hide premium button for premium users; update label for non-premium
    if (premBtn) {
      if (isPremium) {
        premBtn.classList.add('hidden');
      } else {
        premBtn.classList.remove('hidden');
        premBtn.textContent = '⭐ Get Premium';
      }
    }

    // Show/hide premium dashboard
    updatePremiumDashboard(username, isPremium);
  } else {
    statusText.textContent = '';
    actionBtn.textContent = '🔐 Sign In';
    actionBtn.classList.remove('signout-btn');
    actionBtn.onclick = openAuth;

    // Not logged in: show the premium button
    if (premBtn) {
      premBtn.classList.remove('hidden');
      premBtn.textContent = '⭐ Premium';
    }

    // Hide premium dashboard
    const dash = document.getElementById('premium-dashboard');
    if (dash) dash.classList.add('hidden');
  }
}

// ===== Premium Dashboard =====
function updatePremiumDashboard(username, isPremium) {
  const dash = document.getElementById('premium-dashboard');
  if (!dash) return;

  if (!isPremium) {
    dash.classList.add('hidden');
    return;
  }

  dash.classList.remove('hidden');
  document.getElementById('pdash-username').textContent = `@${username}`;
  loadSavedEmails();
  loadApiKey();
}

function switchPDashTab(tab) {
  document.getElementById('pdash-saved').classList.toggle('hidden', tab !== 'saved');
  document.getElementById('pdash-apikey').classList.toggle('hidden', tab !== 'apikey');
  document.querySelectorAll('.pdash-tab').forEach((t, i) => {
    t.classList.toggle('active', (i === 0 && tab === 'saved') || (i === 1 && tab === 'apikey'));
  });
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
    delBtn.className = 'se-del-btn';
    delBtn.textContent = '🗑️';
    delBtn.addEventListener('click', () => deleteSavedEmail(e.address));

    actions.appendChild(useBtn);
    actions.appendChild(delBtn);
    item.appendChild(addr);
    item.appendChild(actions);
    container.appendChild(item);
  });
}

async function addSavedEmail() {
  const input = document.getElementById('new-saved-email');
  const address = input.value.trim();
  if (!address || !address.includes('@')) { showToast('❌ Enter a valid email address'); return; }
  const token = localStorage.getItem('authToken');
  if (!token) return;
  try {
    const res = await fetch('/api/user/saved-emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ address })
    });
    const data = await res.json();
    if (res.ok) { input.value = ''; renderSavedEmails(data.savedEmails); showToast('✅ Email saved!'); }
    else showToast('❌ ' + (data.error || 'Error'));
  } catch (e) { showToast('❌ Network error'); }
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
  scheduleRender();
  refreshEmails();
  showToast('✅ Now using ' + address);
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

function signOut() {
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
}

async function signUp() {
  const username = document.getElementById('signup-username').value.trim();
  const password = document.getElementById('signup-password').value;
  const email = document.getElementById('signup-email').value.trim();
  if (!username || !password) { showAuthError('Username and password are required'); return; }

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

// ===== Global Key/Click Listeners =====
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal(); closeAbout(); closeQR(); closePremiumFlow(); closeAuth();
  }
});

document.getElementById('email-modal')?.addEventListener('click', e => { if (e.target.id === 'email-modal') closeModal(); });
document.getElementById('about-modal')?.addEventListener('click', e => { if (e.target.id === 'about-modal') closeAbout(); });
document.getElementById('qr-modal')?.addEventListener('click', e => { if (e.target.id === 'qr-modal') closeQR(); });
document.getElementById('premium-flow-overlay')?.addEventListener('click', e => { if (e.target.id === 'premium-flow-overlay') closePremiumFlow(); });
document.getElementById('auth-modal')?.addEventListener('click', e => { if (e.target.id === 'auth-modal') closeAuth(); });

// Initialize auth state on load
document.addEventListener('DOMContentLoaded', initAuthState);
