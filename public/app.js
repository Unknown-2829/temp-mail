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
  "No signup. No traces."
];

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
  rotateQuotes();
  setInterval(rotateQuotes, 8000);

  // Check for saved email
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
  document.getElementById('quote-text').textContent = `"${quote}"`;
}

// Generate Email with 2 second delay
async function generateEmail() {
  const input = document.getElementById('email-display');
  input.value = 'Generating...';
  input.style.opacity = '0.6';

  // Show generating for 2 seconds
  await new Promise(resolve => setTimeout(resolve, 2000));

  try {
    const response = await fetch('/api/generate', { method: 'POST' });

    if (!response.ok) {
      throw new Error('Failed to generate');
    }

    const data = await response.json();
    currentEmail = data.email;

    input.value = currentEmail;
    input.style.opacity = '1';

    // Save
    sessionStorage.setItem('tempEmail', currentEmail);
    sessionStorage.setItem('emailCreatedAt', Date.now().toString());

    startAutoRefresh();
    showToast('✨ Email ready!');

  } catch (error) {
    console.error(error);
    input.value = 'Error - Click Regenerate';
    input.style.opacity = '1';
    showToast('❌ Error generating email');
  }
}

// Regenerate Email
async function regenerateEmail() {
  stopAutoRefresh();
  emailsList = [];
  renderInbox();
  await generateEmail();
}

// Delete Email
function deleteEmail() {
  stopAutoRefresh();
  currentEmail = '';
  emailsList = [];
  sessionStorage.removeItem('tempEmail');
  sessionStorage.removeItem('emailCreatedAt');
  document.getElementById('email-display').value = '';
  renderInbox();
  showToast('🗑️ Deleted');
  setTimeout(generateEmail, 500);
}

// Copy Email
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

// Refresh Emails
async function refreshEmails() {
  if (!currentEmail) return;

  try {
    const response = await fetch(`/api/emails?address=${encodeURIComponent(currentEmail)}`);
    const data = await response.json();

    const oldCount = emailsList.length;
    emailsList = data.emails || [];

    if (emailsList.length > oldCount && oldCount > 0) {
      showToast(`📧 ${emailsList.length - oldCount} new email(s)!`);
    }

    renderInbox();

  } catch (error) {
    console.error('Refresh error:', error);
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

  container.innerHTML = emailsList.map((email, index) => {
    const sender = extractSenderName(email.from);
    const subject = email.subject || '(No Subject)';

    return `
      <div class="email-row ${email.read ? '' : 'unread'}" onclick="viewEmail(${index})">
        <div class="email-sender">${escapeHtml(sender)}</div>
        <div class="email-subject">${escapeHtml(subject)}</div>
        <div class="email-view">
          <button class="view-btn">View</button>
        </div>
      </div>
    `;
  }).join('');
}

// View Email - Full content, preserved HTML
function viewEmail(index) {
  const email = emailsList[index];
  if (!email) return;

  email.read = true;
  renderInbox();

  document.getElementById('modal-subject').textContent = email.subject || '(No Subject)';
  document.getElementById('modal-from').textContent = email.from;
  document.getElementById('modal-time').textContent = formatDateTime(email.timestamp);
  document.getElementById('modal-avatar').textContent = extractSenderName(email.from).charAt(0).toUpperCase();

  // Render full email body - HTML preserved
  const bodyContainer = document.getElementById('modal-body');

  if (email.htmlBody) {
    // Full HTML preserved
    bodyContainer.innerHTML = sanitizeHtml(email.htmlBody);
    // Make links work
    bodyContainer.querySelectorAll('a').forEach(a => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    });
  } else if (email.body) {
    // Plain text with links
    bodyContainer.innerHTML = `<div style="white-space: pre-wrap;">${linkify(escapeHtml(email.body))}</div>`;
  } else {
    bodyContainer.innerHTML = '<p style="color: #888;">No content</p>';
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
        <span style="color:#888;font-size:11px;">(${formatFileSize(att.size)})</span>
      </div>
    `).join('');
  } else {
    attachSection.classList.add('hidden');
  }

  document.getElementById('email-modal').classList.add('show');
}

function closeModal() {
  document.getElementById('email-modal').classList.remove('show');
}

// Download Attachment
function downloadAttachment(emailIndex, attachmentIndex) {
  const att = emailsList[emailIndex].attachments[attachmentIndex];
  if (!att || !att.data) {
    showToast('❌ Not available');
    return;
  }

  try {
    const byteChars = atob(att.data);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteArray[i] = byteChars.charCodeAt(i);
    }
    const blob = new Blob([byteArray], { type: att.contentType || 'application/octet-stream' });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = att.filename;
    a.click();
    URL.revokeObjectURL(url);

    showToast('📥 Downloading...');
  } catch (e) {
    showToast('❌ Download failed');
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
function extractSenderName(from) {
  if (!from) return 'Unknown';
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  const emailMatch = from.match(/([^@<\s]+)@/);
  if (emailMatch) return emailMatch[1];
  return from.split('@')[0] || 'Unknown';
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function sanitizeHtml(html) {
  if (!html) return '';
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '#')
    .replace(/on\w+\s*=/gi, 'data-x=');
}

function linkify(text) {
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  return text.replace(urlRegex, '<a href="$1" target="_blank" style="color:#00d09c;">$1</a>');
}

function formatDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString();
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileIcon(filename) {
  if (!filename) return '📎';
  const ext = filename.split('.').pop().toLowerCase();
  const icons = { pdf: '📄', doc: '📝', docx: '📝', jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', zip: '📦', mp3: '🎵', mp4: '🎬' };
  return icons[ext] || '📎';
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  document.getElementById('toast-message').textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// Keyboard
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

document.getElementById('email-modal')?.addEventListener('click', e => {
  if (e.target.id === 'email-modal') closeModal();
});
