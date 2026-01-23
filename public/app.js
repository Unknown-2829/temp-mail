/* TempMail - JavaScript */

let currentEmail = '';
let emailsList = [];
let autoRefreshInterval = null;
let currentViewIndex = -1;

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
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
  renderInbox();
  localStorage.removeItem('tempEmail');
  localStorage.removeItem('emailCreatedAt');
  await generateEmail();
}

function deleteEmail() {
  stopAutoRefresh();
  currentEmail = '';
  emailsList = [];
  localStorage.removeItem('tempEmail');
  localStorage.removeItem('emailCreatedAt');
  document.getElementById('email-display').value = '';
  renderInbox();
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

    if (emailsList.length > oldCount && oldCount > 0) {
      showToast(`📧 ${emailsList.length - oldCount} new!`);
    }

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
          <svg class="loading-arrows" viewBox="0 0 80 80">
            <path d="M40 8 A32 32 0 0 1 72 40" fill="none" stroke="#d0d0d0" stroke-width="3" stroke-linecap="round"/>
            <polygon points="72,34 72,46 64,40" fill="#d0d0d0"/>
            <path d="M40 72 A32 32 0 0 1 8 40" fill="none" stroke="#d0d0d0" stroke-width="3" stroke-linecap="round"/>
            <polygon points="8,34 8,46 16,40" fill="#d0d0d0"/>
          </svg>
          <div class="loading-icon">✉️</div>
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
    match = from.match(/<?([^@<\s]+@[^>\s]+)>?/);
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

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
document.getElementById('email-modal')?.addEventListener('click', e => { if (e.target.id === 'email-modal') closeModal(); });
