/* TempMail - JavaScript */

let currentEmail = '';
let emailsList = [];
let autoRefreshInterval = null;

// Short powerful quotes
const quotes = [
  "Privacy is power.",
  "Your data. Your rules.",
  "Stay anonymous. Stay safe.",
  "Zero spam. Zero tracking.",
  "Protect your real inbox.",
  "Temporary email. Permanent privacy.",
  "No signup. No traces.",
  "Anonymous by design."
];

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
  rotateQuotes();
  setInterval(rotateQuotes, 8000);

  const saved = sessionStorage.getItem('tempEmail');
  const savedTime = sessionStorage.getItem('emailCreatedAt');

  if (saved && savedTime && (Date.now() - parseInt(savedTime)) < 3600000) {
    currentEmail = saved;
    document.getElementById('email-display').value = currentEmail;
    startAutoRefresh();
    refreshEmails();
  } else {
    await generateEmail();
  }
}

function rotateQuotes() {
  const quote = quotes[Math.floor(Math.random() * quotes.length)];
  const el = document.getElementById('quote-text');
  if (el) el.textContent = `"${quote}"`;
}

// Generate Email
async function generateEmail() {
  const input = document.getElementById('email-display');
  input.value = 'Generating...';
  input.style.opacity = '0.6';

  await new Promise(r => setTimeout(r, 1500));

  try {
    const response = await fetch('/api/generate', { method: 'POST' });
    if (!response.ok) throw new Error('Failed');

    const data = await response.json();
    currentEmail = data.email;

    input.value = currentEmail;
    input.style.opacity = '1';

    sessionStorage.setItem('tempEmail', currentEmail);
    sessionStorage.setItem('emailCreatedAt', Date.now().toString());

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
  await generateEmail();
}

function deleteEmail() {
  stopAutoRefresh();
  currentEmail = '';
  emailsList = [];
  sessionStorage.clear();
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

// Refresh
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

// Render Inbox
function renderInbox() {
  const container = document.getElementById('inbox-body');

  if (emailsList.length === 0) {
    container.innerHTML = `
      <div class="empty-inbox">
        <div class="loader"></div>
        <p class="empty-title">Your inbox is empty</p>
        <p class="empty-subtitle">Waiting for incoming emails</p>
      </div>
    `;
    return;
  }

  container.innerHTML = emailsList.map((email, i) => {
    const sender = parseSender(email.from);
    const subject = email.subject || '(No Subject)';
    const initial = sender.name.charAt(0).toUpperCase();

    return `
      <div class="email-row ${email.read ? '' : 'unread'}" onclick="viewEmail(${i})">
        <div class="email-sender">
          <div class="sender-dot">${initial}</div>
          <span class="sender-name">${escapeHtml(sender.name)}</span>
        </div>
        <div class="email-subject">${escapeHtml(subject)}</div>
        <div class="email-view">
          <button class="view-btn">View</button>
        </div>
      </div>
    `;
  }).join('');
}

// Parse Sender - Better identification
function parseSender(from) {
  if (!from) return { name: 'Unknown', email: '' };

  // Try "Name <email>" format
  let match = from.match(/^"?([^"<]+)"?\s*<([^>]+)>/);
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() };
  }

  // Just email
  match = from.match(/<?([^@<\s]+)@([^>\s]+)>?/);
  if (match) {
    let name = match[1];
    // Capitalize and clean
    name = name.replace(/[._-]/g, ' ');
    name = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return { name, email: `${match[1]}@${match[2]}` };
  }

  return { name: from, email: from };
}

// View Email
function viewEmail(index) {
  const email = emailsList[index];
  if (!email) return;

  email.read = true;
  renderInbox();

  const sender = parseSender(email.from);

  document.getElementById('modal-subject').textContent = email.subject || '(No Subject)';
  document.getElementById('modal-avatar').textContent = sender.name.charAt(0).toUpperCase();
  document.getElementById('modal-time').textContent = formatDateTime(email.timestamp);

  // Update sender info
  const senderInfo = document.querySelector('.sender-info');
  senderInfo.innerHTML = `
    <div class="sender-avatar">${sender.name.charAt(0).toUpperCase()}</div>
    <div class="sender-details">
      <div class="sender-name-full">${escapeHtml(sender.name)}</div>
      <div class="sender-email-full">${escapeHtml(sender.email || email.from)}</div>
      <div class="sender-time">${formatDateTime(email.timestamp)}</div>
    </div>
  `;

  // Body - Full HTML preserved
  const body = document.getElementById('modal-body');

  if (email.htmlBody) {
    body.innerHTML = sanitizeHtml(email.htmlBody);
    body.querySelectorAll('a').forEach(a => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    });
  } else if (email.body) {
    body.innerHTML = `<div style="white-space:pre-wrap;word-break:break-word;">${linkify(escapeHtml(email.body))}</div>`;
  } else {
    body.innerHTML = '<p style="color:#888;">No content</p>';
  }

  // Attachments
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

function closeModal() {
  document.getElementById('email-modal').classList.remove('show');
  document.body.style.overflow = '';
}

// Download
function downloadAttachment(ei, ai) {
  const att = emailsList[ei]?.attachments?.[ai];
  if (!att?.data) {
    showToast('❌ Not available');
    return;
  }

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
  } catch (e) {
    showToast('❌ Failed');
  }
}

// Auto Refresh
function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshInterval = setInterval(refreshEmails, 5000);
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

// Helpers
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

function formatDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const s = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
}

function getFileIcon(name) {
  if (!name) return '📎';
  const ext = name.split('.').pop().toLowerCase();
  const icons = { pdf: '📄', doc: '📝', docx: '📝', jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', zip: '📦', mp3: '🎵', mp4: '🎬', txt: '📃' };
  return icons[ext] || '📎';
}

function showToast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toast-message').textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// Events
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

document.getElementById('email-modal')?.addEventListener('click', e => {
  if (e.target.id === 'email-modal') closeModal();
});
