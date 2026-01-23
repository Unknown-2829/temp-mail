/* TempMail - JavaScript */

let currentEmail = '';
let emailsList = [];
let autoRefreshInterval = null;
let currentViewIndex = -1;
let previousEmailCount = 0;
const originalTitle = document.title;

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Request notification permission
  requestNotificationPermission();

  const saved = localStorage.getItem('tempEmail');
  const savedTime = localStorage.getItem('emailCreatedAt');

  if (saved && savedTime && (Date.now() - parseInt(savedTime)) < 3600000) {
    currentEmail = saved;
    document.getElementById('email-display').value = currentEmail;
    startAutoRefresh();
    refreshEmails();
  } else {
    localStorage.removeItem('tempEmail');
    localStorage.removeItem('emailCreatedAt');
    await generateEmail();
  }
}

// Notification Permission
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// Show browser notification
function showNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body: body,
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📬</text></svg>'
    });
  }
}

// Update tab title with email count
function updateTabTitle(newCount) {
  if (newCount > 0) {
    document.title = `(${newCount}) ${originalTitle}`;
  } else {
    document.title = originalTitle;
  }
}

async function generateEmail() {
  const input = document.getElementById('email-display');
  input.value = 'Loading...';
  input.style.opacity = '0.6';

  await new Promise(r => setTimeout(r, 1200));

  try {
    const response = await fetch('/api/generate', { method: 'POST' });
    if (!response.ok) throw new Error('Failed');

    const data = await response.json();
    currentEmail = data.email;

    input.value = currentEmail;
    input.style.opacity = '1';

    localStorage.setItem('tempEmail', currentEmail);
    localStorage.setItem('emailCreatedAt', Date.now().toString());

    startAutoRefresh();
    showToast('✨ Email ready!');
  } catch (e) {
    input.value = 'Error - Tap Regenerate';
    input.style.opacity = '1';
    showToast('❌ Error');
  }
}

async function regenerateEmail() {
  stopAutoRefresh();
  emailsList = [];
  previousEmailCount = 0;
  renderInbox();
  localStorage.removeItem('tempEmail');
  localStorage.removeItem('emailCreatedAt');
  await generateEmail();
}

function deleteEmail() {
  stopAutoRefresh();
  currentEmail = '';
  emailsList = [];
  previousEmailCount = 0;
  localStorage.removeItem('tempEmail');
  localStorage.removeItem('emailCreatedAt');
  document.getElementById('email-display').value = '';
  renderInbox();
  updateTabTitle(0);
  showToast('🗑️ Deleted');
  setTimeout(generateEmail, 500);
}

function copyEmail() {
  if (!currentEmail) return;
  navigator.clipboard.writeText(currentEmail).then(() => {
    showToast('📋 Copied!');
  }).catch(() => {
    const input = document.getElementById('email-display');
    input.select();
    document.execCommand('copy');
    showToast('📋 Copied!');
  });
}

async function refreshEmails() {
  if (!currentEmail) return;

  try {
    const response = await fetch(`/api/emails?address=${encodeURIComponent(currentEmail)}`);
    const data = await response.json();

    const oldCount = emailsList.length;
    emailsList = data.emails || [];
    const newCount = emailsList.length;

    // New email notifications
    if (newCount > oldCount && oldCount > 0) {
      const diff = newCount - oldCount;
      showToast(`📧 ${diff} new!`);
      showNotification('New Email!', `You have ${diff} new email(s)`);
    }

    // Update tab title with unread count
    const unreadCount = emailsList.filter(e => !e.read).length;
    updateTabTitle(unreadCount);

    renderInbox();
  } catch (e) {
    console.error(e);
  }
}

function renderInbox() {
  const container = document.getElementById('inbox-body');

  if (emailsList.length === 0) {
    container.innerHTML = `
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

  container.innerHTML = emailsList.map((email, i) => {
    const sender = parseSender(email.from, email);
    const subject = email.subject || '(No Subject)';

    return `
      <div class="email-row ${email.read ? '' : 'unread'}" onclick="viewEmail(${i})">
        <div class="email-sender">
          <span class="sender-name">${escapeHtml(sender.name)}</span>
          <span class="sender-email-small">${escapeHtml(sender.email)}</span>
        </div>
        <div class="email-subject">${escapeHtml(subject)}</div>
        <div class="email-view">
          <span class="view-arrow">›</span>
        </div>
      </div>
    `;
  }).join('');
}

// Parse Sender - with content-based detection for services like Netflix
function parseSender(from, emailObj) {
  if (!from) return { name: 'Unknown', email: '' };

  let emailAddr = from;
  let name = '';

  // Try "Name <email>" format
  let match = from.match(/^"?([^"<]+)"?\s*<([^>]+)>/);
  if (match) {
    name = match[1].trim();
    emailAddr = match[2].trim();
  } else {
    // Just email
    match = from.match(/<?([\^@<\s]+@[^>\s]+)>?/);
    if (match) emailAddr = match[1];
  }

  // If name is empty or looks like UUID, detect from content
  if (!name || looksLikeUUID(name) || looksLikeUUID(emailAddr.split('@')[0])) {
    name = detectSenderFromContent(emailObj) || extractFromDomain(emailAddr);
  }

  return { name, email: emailAddr };
}

function looksLikeUUID(str) {
  if (!str) return false;
  const cleaned = str.replace(/[-_\s]/g, '');
  if (/^[0-9a-f]{16,}$/i.test(cleaned)) return true;
  if (str.length > 20 && /^[0-9a-zA-Z-_]+$/.test(str)) return true;
  return false;
}

// Detect sender name from email content
function detectSenderFromContent(email) {
  if (!email) return null;

  const content = ((email.subject || '') + (email.body || '') + (email.htmlBody || '')).toLowerCase();

  const services = [
    { k: ['netflix'], n: 'Netflix' },
    { k: ['amazon', 'aws'], n: 'Amazon' },
    { k: ['google', 'gmail'], n: 'Google' },
    { k: ['facebook', 'meta'], n: 'Facebook' },
    { k: ['twitter'], n: 'Twitter' },
    { k: ['instagram'], n: 'Instagram' },
    { k: ['linkedin'], n: 'LinkedIn' },
    { k: ['spotify'], n: 'Spotify' },
    { k: ['paypal'], n: 'PayPal' },
    { k: ['microsoft', 'outlook'], n: 'Microsoft' },
    { k: ['apple', 'icloud'], n: 'Apple' },
    { k: ['uber'], n: 'Uber' },
    { k: ['discord'], n: 'Discord' },
    { k: ['github'], n: 'GitHub' },
    { k: ['whatsapp'], n: 'WhatsApp' },
    { k: ['telegram'], n: 'Telegram' },
    { k: ['steam'], n: 'Steam' },
    { k: ['adobe'], n: 'Adobe' },
    { k: ['zoom'], n: 'Zoom' },
  ];

  for (const s of services) {
    for (const k of s.k) {
      if (content.includes(k)) return s.n;
    }
  }
  return null;
}

function extractFromDomain(email) {
  const domain = email.split('@')[1];
  if (!domain) return 'Unknown';

  // Skip common email service subdomains
  const skip = ['amazonses', 'sendgrid', 'mailchimp', 'mailgun', 'us-west', 'us-east', 'eu-west', 'ap-south'];
  const parts = domain.split('.');

  for (const s of skip) {
    if (domain.includes(s)) return 'Notification';
  }

  let name = parts[0];
  if (['mail', 'email', 'noreply', 'notify', 'info', 'account'].includes(name) && parts[1]) {
    name = parts[1];
  }

  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

function viewEmail(index) {
  const email = emailsList[index];
  if (!email) return;

  currentViewIndex = index;
  email.read = true;

  // Update tab title after marking as read
  const unreadCount = emailsList.filter(e => !e.read).length;
  updateTabTitle(unreadCount);

  renderInbox();

  const sender = parseSender(email.from, email);

  document.getElementById('modal-avatar').textContent = sender.name.charAt(0).toUpperCase();
  document.getElementById('modal-sender-name').textContent = sender.name;
  document.getElementById('modal-sender-email').textContent = sender.email;
  document.getElementById('modal-date').textContent = formatDate(email.timestamp);
  document.getElementById('modal-subject').textContent = email.subject || '(No Subject)';

  const body = document.getElementById('modal-body');

  if (email.htmlBody) {
    // Clean HTML - remove broken UTF-8 characters
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

// Clean broken UTF-8 characters (Â, Ã, etc.)
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
    emailsList.splice(currentViewIndex, 1);
    const unreadCount = emailsList.filter(e => !e.read).length;
    updateTabTitle(unreadCount);
    renderInbox();
    closeModal();
    showToast('🗑️ Email deleted');
  }
}

function viewSource() {
  if (currentViewIndex >= 0) {
    const email = emailsList[currentViewIndex];
    const source = email.rawSource || email.htmlBody || email.body || 'No source';
    document.getElementById('modal-body').innerHTML = `<pre style="background:#f5f5f5;padding:15px;border-radius:8px;overflow-x:auto;font-size:12px;">${escapeHtml(source)}</pre>`;
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
    a.href = url;
    a.download = att.filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast('📥 Downloading...');
  } catch (e) { showToast('❌ Failed'); }
}

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshInterval = setInterval(refreshEmails, 5000);
}

function stopAutoRefresh() {
  if (autoRefreshInterval) { clearInterval(autoRefreshInterval); autoRefreshInterval = null; }
}

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
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
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

function showToast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toast-message').textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ========== QR Code Functions ==========
function showQR() {
  if (!currentEmail) {
    showToast('❌ No email to show');
    return;
  }

  const container = document.getElementById('qr-code-container');
  container.innerHTML = '';

  // Generate QR code using the library
  QRCode.toCanvas(currentEmail, { width: 180, margin: 0 }, (err, canvas) => {
    if (err) {
      showToast('❌ QR Error');
      return;
    }
    container.appendChild(canvas);
  });

  document.getElementById('qr-email-display').textContent = currentEmail;
  document.getElementById('qr-modal').classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeQR() {
  document.getElementById('qr-modal').classList.remove('show');
  document.body.style.overflow = '';
}

// ========== Premium Modal Functions ==========
function openPremium() {
  document.getElementById('premium-modal').classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closePremium() {
  document.getElementById('premium-modal').classList.remove('show');
  document.body.style.overflow = '';
}

function copyCrypto(id) {
  const code = document.getElementById(id);
  if (!code) return;
  navigator.clipboard.writeText(code.textContent).then(() => {
    showToast('📋 Address copied!');
  }).catch(() => {
    showToast('❌ Copy failed');
  });
}

// ========== Auth Modal Functions ==========
function openAuth() {
  closePremium();
  document.getElementById('auth-modal').classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeAuth() {
  document.getElementById('auth-modal').classList.remove('show');
  document.body.style.overflow = '';
  // Reset form
  document.getElementById('auth-email').value = '';
  document.getElementById('otp-input').value = '';
  document.getElementById('otp-section').classList.add('hidden');
  document.getElementById('auth-error').classList.add('hidden');
}

async function sendOTP() {
  const emailInput = document.getElementById('auth-email');
  const sendBtn = document.getElementById('send-otp-btn');
  const email = emailInput.value.trim();

  if (!email || !email.includes('@')) {
    showAuthError('Please enter a valid email');
    return;
  }

  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending...';

  try {
    const response = await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const data = await response.json();

    if (response.ok) {
      document.getElementById('otp-section').classList.remove('hidden');
      showToast('📧 Code sent!');
    } else {
      showAuthError(data.error || 'Failed to send code');
    }
  } catch (e) {
    showAuthError('Network error. Try again.');
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send Code';
  }
}

async function verifyOTP() {
  const email = document.getElementById('auth-email').value.trim();
  const otp = document.getElementById('otp-input').value.trim();

  if (!otp || otp.length !== 6) {
    showAuthError('Please enter the 6-digit code');
    return;
  }

  try {
    const response = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });

    const data = await response.json();

    if (response.ok) {
      localStorage.setItem('authToken', data.token);
      localStorage.setItem('userEmail', email);
      localStorage.setItem('isPremium', data.isPremium ? 'true' : 'false');
      closeAuth();
      showToast('✅ Logged in!');
      // Refresh page to apply premium status
      location.reload();
    } else {
      showAuthError(data.error || 'Invalid code');
    }
  } catch (e) {
    showAuthError('Network error. Try again.');
  }
}

function showAuthError(msg) {
  const errEl = document.getElementById('auth-error');
  errEl.textContent = msg;
  errEl.classList.remove('hidden');
}

// ========== About Modal ==========
function openAbout() {
  document.getElementById('about-modal').classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeAbout() {
  document.getElementById('about-modal').classList.remove('show');
  document.body.style.overflow = '';
}

// ========== Event Listeners ==========
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    closeAbout();
    closeQR();
    closePremium();
    closeAuth();
  }
});

document.getElementById('email-modal')?.addEventListener('click', e => {
  if (e.target.id === 'email-modal') closeModal();
});

document.getElementById('about-modal')?.addEventListener('click', e => {
  if (e.target.id === 'about-modal') closeAbout();
});

document.getElementById('qr-modal')?.addEventListener('click', e => {
  if (e.target.id === 'qr-modal') closeQR();
});

document.getElementById('premium-modal')?.addEventListener('click', e => {
  if (e.target.id === 'premium-modal') closePremium();
});

document.getElementById('auth-modal')?.addEventListener('click', e => {
  if (e.target.id === 'auth-modal') closeAuth();
});
