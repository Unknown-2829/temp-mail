/* TempMail - JavaScript */

let currentEmail = '';
let emailsList = [];
let autoRefreshInterval = null;

// Quotes
const quotes = [
  "Privacy is the foundation of all other rights.",
  "In the digital age, privacy is not a luxury—it's a necessity.",
  "Your digital footprint is permanent. Guard it wisely.",
  "Privacy isn't about hiding. It's about control.",
  "Data is the new oil, and privacy is the new green.",
  "Arguing you don't care about privacy because you have nothing to hide is like saying you don't care about free speech because you have nothing to say.",
  "Privacy is not something that I'm merely entitled to, it's an absolute prerequisite.",
  "The right to privacy is the right to be left alone."
];

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
  rotateQuotes();
  setInterval(rotateQuotes, 30000);

  // Check for saved email
  const savedEmail = sessionStorage.getItem('tempEmail');
  const savedTime = sessionStorage.getItem('emailCreatedAt');

  if (savedEmail && savedTime && (Date.now() - parseInt(savedTime)) < 3600000) {
    currentEmail = savedEmail;
    document.getElementById('email-display').value = currentEmail;
    startAutoRefresh();
    refreshEmails();
  } else {
    await generateEmail();
  }
}

function rotateQuotes() {
  const quote = quotes[Math.floor(Math.random() * quotes.length)];
  const headerQuote = document.getElementById('header-quote');
  const infoQuote = document.getElementById('info-quote');

  if (headerQuote) headerQuote.innerHTML = `<span>"${quote}"</span>`;
  if (infoQuote) infoQuote.textContent = `"${quote}"`;
}

// Generate Email
async function generateEmail() {
  const emailInput = document.getElementById('email-display');
  emailInput.value = 'Generating...';

  try {
    const response = await fetch('/api/generate', { method: 'POST' });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to generate email');
    }

    const data = await response.json();
    currentEmail = data.email;
    emailInput.value = currentEmail;

    // Save to session
    sessionStorage.setItem('tempEmail', currentEmail);
    sessionStorage.setItem('emailCreatedAt', Date.now().toString());

    // Start auto refresh
    startAutoRefresh();

    showToast('✨ Email generated!');

  } catch (error) {
    console.error('Generate error:', error);
    emailInput.value = 'Error - Click Change to retry';
    showToast('❌ ' + error.message);
  }
}

// Change Email (Generate New)
async function changeEmail() {
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
  showToast('🗑️ Email deleted');

  // Generate new one
  setTimeout(generateEmail, 500);
}

// Copy Email
function copyEmail() {
  if (!currentEmail) return;

  navigator.clipboard.writeText(currentEmail).then(() => {
    showToast('📋 Copied to clipboard!');
  }).catch(() => {
    // Fallback
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
  const emptyInbox = document.getElementById('empty-inbox');

  if (emailsList.length === 0) {
    container.innerHTML = '';
    container.innerHTML = `
      <div class="empty-inbox">
        <div class="loading-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 12A10 10 0 1 1 12 2"/>
          </svg>
        </div>
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

// View Email
function viewEmail(index) {
  const email = emailsList[index];
  if (!email) return;

  email.read = true;
  renderInbox();

  // Populate modal
  document.getElementById('modal-subject').textContent = email.subject || '(No Subject)';
  document.getElementById('modal-from').textContent = email.from;
  document.getElementById('modal-time').textContent = formatDateTime(email.timestamp);
  document.getElementById('modal-avatar').textContent = extractSenderName(email.from).charAt(0).toUpperCase();

  // Render body
  const bodyContainer = document.getElementById('modal-body');
  if (email.htmlBody) {
    bodyContainer.innerHTML = sanitizeHtml(email.htmlBody);
    // Open links in new tab
    bodyContainer.querySelectorAll('a').forEach(a => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    });
  } else if (email.body) {
    bodyContainer.innerHTML = linkify(escapeHtml(email.body));
  } else {
    bodyContainer.innerHTML = '<p style="color: #888;">No content</p>';
  }

  // Attachments
  const attachmentsSection = document.getElementById('modal-attachments');
  const attachmentsList = document.getElementById('attachments-list');

  if (email.attachments && email.attachments.length > 0) {
    attachmentsSection.classList.remove('hidden');
    attachmentsList.innerHTML = email.attachments.map((att, i) => `
      <div class="attachment-item" onclick="downloadAttachment(${index}, ${i})">
        <span class="attachment-icon">${getFileIcon(att.filename)}</span>
        <span class="attachment-name">${escapeHtml(att.filename)}</span>
        <span class="attachment-size">(${formatFileSize(att.size)})</span>
      </div>
    `).join('');
  } else {
    attachmentsSection.classList.add('hidden');
  }

  // Show modal
  document.getElementById('email-modal').classList.add('show');
}

function closeModal() {
  document.getElementById('email-modal').classList.remove('show');
}

// Download Attachment
function downloadAttachment(emailIndex, attachmentIndex) {
  const email = emailsList[emailIndex];
  const att = email.attachments[attachmentIndex];

  if (!att || !att.data) {
    showToast('❌ Attachment not available');
    return;
  }

  try {
    const byteChars = atob(att.data);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteNumbers[i] = byteChars.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: att.contentType || 'application/octet-stream' });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = att.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('📥 Download started');
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

// Helper Functions
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
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/javascript:/gi, '#')
    .replace(/on\w+\s*=/gi, 'data-removed=');
}

function linkify(text) {
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  return text.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

function formatDateTime(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString();
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
  const icons = {
    pdf: '📄', doc: '📝', docx: '📝', txt: '📃',
    xls: '📊', xlsx: '📊', csv: '📊',
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️',
    mp3: '🎵', wav: '🎵',
    mp4: '🎬', mov: '🎬',
    zip: '📦', rar: '📦'
  };
  return icons[ext] || '📎';
}

function showQR() {
  showToast('QR Code feature coming soon!');
}

// Toast
function showToast(message) {
  const toast = document.getElementById('toast');
  document.getElementById('toast-message').textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// Close modal on escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// Close modal on backdrop click
document.getElementById('email-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'email-modal') closeModal();
});
