/* ========================================
   TempMail Pro - JavaScript
   Premium Features with Theme Toggle
   ======================================== */

let currentEmail = '';
let autoRefreshInterval = null;
let emailsList = [];
let selectedEmailIndex = -1;

// Privacy Quotes
const quotes = [
  { text: "Privacy is not something that I'm merely entitled to, it's an absolute prerequisite.", author: "Marlon Brando" },
  { text: "In the digital age, privacy is not a luxury—it's a necessity.", author: "Unknown" },
  { text: "Privacy is the foundation of all other rights.", author: "Edward Snowden" },
  { text: "The right to privacy is the right to be left alone.", author: "Louis Brandeis" },
  { text: "Arguing that you don't care about privacy because you have nothing to hide is like saying you don't care about free speech because you have nothing to say.", author: "Edward Snowden" },
  { text: "Privacy is not about hiding something. It's about being able to control how we present ourselves.", author: "Bruce Schneier" },
  { text: "Data is the new oil, and privacy is the new green.", author: "Unknown" },
  { text: "In the age of transparency, privacy has become a valued currency.", author: "Unknown" },
  { text: "Your digital footprint is permanent. Guard it wisely.", author: "Unknown" },
  { text: "Privacy isn't about secrecy. It's about autonomy.", author: "Unknown" }
];

// ========================================
// Theme Management
// ========================================

function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  setTheme(savedTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  setTheme(newTheme);
  localStorage.setItem('theme', newTheme);
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const themeSwitch = document.getElementById('theme-switch');
  if (themeSwitch) {
    if (theme === 'light') {
      themeSwitch.classList.add('light');
    } else {
      themeSwitch.classList.remove('light');
    }
  }
}

// ========================================
// Quote Management
// ========================================

function initQuote() {
  rotateQuote();
  // Rotate quotes every 30 seconds
  setInterval(rotateQuote, 30000);
}

function rotateQuote() {
  const quote = quotes[Math.floor(Math.random() * quotes.length)];
  const quoteText = document.getElementById('quote-text');
  const quoteAuthor = document.getElementById('quote-author');

  if (quoteText && quoteAuthor) {
    quoteText.textContent = `"${quote.text}"`;
    quoteAuthor.textContent = `— ${quote.author}`;
  }
}

// ========================================
// Email Generation
// ========================================

async function generateEmail() {
  const btn = document.getElementById('generate-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span><span>Generating...</span>';

  try {
    const response = await fetch('/api/generate', { method: 'POST' });

    if (!response.ok) {
      throw new Error('Failed to generate email');
    }

    const data = await response.json();
    currentEmail = data.email;

    // Save to session
    sessionStorage.setItem('tempEmail', currentEmail);
    sessionStorage.setItem('emailCreatedAt', Date.now().toString());

    // Update UI
    document.getElementById('email-address').textContent = currentEmail;
    document.getElementById('no-email').classList.add('hidden');
    document.getElementById('current-email').classList.remove('hidden');
    document.getElementById('welcome-screen').classList.add('hidden');
    document.getElementById('inbox-view').classList.remove('hidden');

    // Start auto-refresh
    document.getElementById('auto-refresh').checked = true;
    toggleAutoRefresh();

    // Start expiry countdown
    startExpiryCountdown();

    // Check emails immediately
    checkEmails();

    showToast('✨ Email generated successfully!');

  } catch (error) {
    console.error('Error:', error);
    showToast('❌ Error generating email', 'error');
  }

  btn.disabled = false;
  btn.innerHTML = '<span class="btn-icon">✨</span><span>New Email</span>';
}

// ========================================
// Email Checking
// ========================================

async function checkEmails() {
  if (!currentEmail) return;

  try {
    const response = await fetch(`/api/emails?address=${encodeURIComponent(currentEmail)}`);
    const data = await response.json();

    const oldCount = emailsList.length;
    emailsList = data.emails || [];

    // Notify if new emails arrived
    if (emailsList.length > oldCount && oldCount > 0) {
      showToast(`📧 ${emailsList.length - oldCount} new email(s) received!`);
    }

    // Update counts
    document.getElementById('inbox-count').textContent = emailsList.length;
    document.getElementById('list-count').textContent = emailsList.length;
    document.getElementById('emails-received').textContent = emailsList.length;

    renderEmailList();

  } catch (error) {
    console.error('Error checking emails:', error);
  }
}

function renderEmailList() {
  const container = document.getElementById('emails-container');
  const emptyInbox = document.getElementById('empty-inbox');

  if (emailsList.length === 0) {
    container.innerHTML = '';
    container.appendChild(emptyInbox);
    emptyInbox.classList.remove('hidden');
    return;
  }

  emptyInbox.classList.add('hidden');

  container.innerHTML = emailsList.map((email, index) => {
    const senderName = extractSenderName(email.from);
    const preview = stripHtml(email.body || '').substring(0, 80);
    const time = formatTime(email.timestamp);
    const hasAttachments = email.attachments && email.attachments.length > 0;
    const isActive = index === selectedEmailIndex;

    return `
      <div class="email-item ${isActive ? 'active' : ''} ${email.read !== true ? 'unread' : ''}" 
           onclick="viewEmail(${index})">
        <div class="email-item-header">
          <span class="email-sender">${escapeHtml(senderName)}</span>
          <span class="email-time">${time}</span>
        </div>
        <div class="email-subject">${escapeHtml(email.subject || '(No Subject)')}</div>
        <div class="email-preview">${escapeHtml(preview)}${preview ? '...' : ''}</div>
        ${hasAttachments ? `
          <div class="email-item-footer">
            <span class="attachment-badge">📎 ${email.attachments.length} file(s)</span>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

// ========================================
// Email Viewing
// ========================================

function viewEmail(index) {
  selectedEmailIndex = index;
  const email = emailsList[index];

  if (!email) return;

  // Mark as read
  email.read = true;

  // Update list to show active state
  renderEmailList();

  // Show viewer content
  document.getElementById('viewer-placeholder').classList.add('hidden');
  document.getElementById('viewer-content').classList.remove('hidden');

  // Populate email details
  document.getElementById('view-subject').textContent = email.subject || '(No Subject)';

  const senderName = extractSenderName(email.from);
  document.getElementById('view-from').textContent = senderName;
  document.getElementById('view-from-email').textContent = email.from;
  document.getElementById('sender-avatar').textContent = senderName.charAt(0).toUpperCase();
  document.getElementById('view-time').textContent = formatDateTime(email.timestamp);

  // Render email body
  const bodyContainer = document.getElementById('view-body');

  if (email.htmlBody) {
    // Render HTML email
    bodyContainer.innerHTML = sanitizeHtml(email.htmlBody);

    // Make links open in new tab
    bodyContainer.querySelectorAll('a').forEach(link => {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    });
  } else if (email.body) {
    // Render plain text with link detection
    bodyContainer.innerHTML = linkifyText(escapeHtml(email.body));
  } else {
    bodyContainer.innerHTML = '<p style="color: #888;">No content available</p>';
  }

  // Handle attachments
  const attachmentsSection = document.getElementById('attachments-section');
  const attachmentsList = document.getElementById('attachments-list');

  if (email.attachments && email.attachments.length > 0) {
    attachmentsSection.classList.remove('hidden');
    attachmentsList.innerHTML = email.attachments.map((att, i) => `
      <div class="attachment-item" onclick="downloadAttachment(${index}, ${i})">
        <span class="attachment-icon">${getFileIcon(att.filename)}</span>
        <div class="attachment-info">
          <span class="attachment-name">${escapeHtml(att.filename)}</span>
          <span class="attachment-size">${formatFileSize(att.size)}</span>
        </div>
        <span class="attachment-download">⬇️</span>
      </div>
    `).join('');
  } else {
    attachmentsSection.classList.add('hidden');
  }
}

function closeEmail() {
  selectedEmailIndex = -1;
  document.getElementById('viewer-placeholder').classList.remove('hidden');
  document.getElementById('viewer-content').classList.add('hidden');
  renderEmailList();
}

// ========================================
// Attachments
// ========================================

function downloadAttachment(emailIndex, attachmentIndex) {
  const email = emailsList[emailIndex];
  const attachment = email.attachments[attachmentIndex];

  if (!attachment || !attachment.data) {
    showToast('❌ Attachment data not available', 'error');
    return;
  }

  try {
    // Decode base64 and create blob
    const byteCharacters = atob(attachment.data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: attachment.contentType || 'application/octet-stream' });

    // Create download link
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = attachment.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('📥 Download started!');
  } catch (error) {
    console.error('Download error:', error);
    showToast('❌ Download failed', 'error');
  }
}

function downloadEmail() {
  if (selectedEmailIndex < 0) return;

  const email = emailsList[selectedEmailIndex];
  const content = `From: ${email.from}
To: ${email.to}
Subject: ${email.subject}
Date: ${new Date(email.timestamp).toLocaleString()}

${email.body || '(No content)'}`;

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `email-${(email.subject || 'no-subject').substring(0, 30).replace(/[^a-z0-9]/gi, '_')}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('📥 Email downloaded!');
}

// ========================================
// Utility Functions
// ========================================

function copyEmail() {
  if (!currentEmail) return;

  navigator.clipboard.writeText(currentEmail).then(() => {
    showToast('📋 Email copied to clipboard!');

    // Visual feedback on button
    const btn = document.getElementById('copy-btn');
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<span>✓</span>';
    setTimeout(() => {
      btn.innerHTML = originalContent;
    }, 2000);
  }).catch(() => {
    showToast('❌ Failed to copy', 'error');
  });
}

function deleteEmail() {
  // Clear state
  currentEmail = '';
  emailsList = [];
  selectedEmailIndex = -1;
  sessionStorage.removeItem('tempEmail');
  sessionStorage.removeItem('emailCreatedAt');

  // Stop auto-refresh
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }

  // Reset UI
  document.getElementById('no-email').classList.remove('hidden');
  document.getElementById('current-email').classList.add('hidden');
  document.getElementById('welcome-screen').classList.remove('hidden');
  document.getElementById('inbox-view').classList.add('hidden');
  document.getElementById('inbox-count').textContent = '0';
  document.getElementById('emails-received').textContent = '0';
  document.getElementById('time-left').textContent = '60m';

  showToast('🗑️ Email deleted');
}

function toggleAutoRefresh() {
  const checked = document.getElementById('auto-refresh').checked;

  if (checked && currentEmail) {
    autoRefreshInterval = setInterval(checkEmails, 5000);
  } else if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

function showInbox() {
  // Already on inbox view
}

// ========================================
// Helper Functions
// ========================================

function extractSenderName(from) {
  if (!from) return 'Unknown';

  // Extract name from "Name <email>" format
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match && match[1].trim()) {
    return match[1].trim();
  }

  // Extract from email before @
  const emailMatch = from.match(/([^@<\s]+)@/);
  if (emailMatch) {
    let name = emailMatch[1];
    // Capitalize first letter
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  return from.split('@')[0] || 'Unknown';
}

function stripHtml(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function sanitizeHtml(html) {
  if (!html) return '';

  // Remove dangerous elements and attributes
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/javascript:/gi, '#')
    .replace(/on\w+\s*=/gi, 'data-removed=')
    .replace(/<iframe[^>]*>/gi, '')
    .replace(/<embed[^>]*>/gi, '')
    .replace(/<object[^>]*>/gi, '');
}

function linkifyText(text) {
  if (!text) return '';

  // Convert URLs to clickable links
  const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/g;
  return text.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: #6366f1;">$1</a>');
}

function formatTime(timestamp) {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff < 604800000) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatDateTime(timestamp) {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  return date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileIcon(filename) {
  if (!filename) return '📎';

  const ext = filename.split('.').pop().toLowerCase();
  const icons = {
    // Documents
    pdf: '📄', doc: '📝', docx: '📝', txt: '📃', rtf: '📝',
    xls: '📊', xlsx: '📊', csv: '📊',
    ppt: '📽️', pptx: '📽️',
    // Images
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️', bmp: '🖼️', ico: '🖼️',
    // Audio
    mp3: '🎵', wav: '🎵', ogg: '🎵', m4a: '🎵', flac: '🎵',
    // Video
    mp4: '🎬', mov: '🎬', avi: '🎬', mkv: '🎬', webm: '🎬',
    // Archives
    zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',
    // Code
    html: '🌐', css: '🎨', js: '⚡', json: '📋', xml: '📋',
    py: '🐍', java: '☕', cpp: '⚙️', c: '⚙️', rb: '💎',
    // Other
    exe: '⚙️', dmg: '💿', iso: '💿'
  };

  return icons[ext] || '📎';
}

// ========================================
// Expiry Countdown
// ========================================

let expiryTime = null;
let countdownInterval = null;

function startExpiryCountdown() {
  // Check if we have a saved creation time
  const savedCreatedAt = sessionStorage.getItem('emailCreatedAt');
  if (savedCreatedAt) {
    expiryTime = parseInt(savedCreatedAt) + 3600000;
  } else {
    expiryTime = Date.now() + 3600000;
  }

  updateExpiryDisplay();

  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(updateExpiryDisplay, 1000);
}

function updateExpiryDisplay() {
  if (!expiryTime) return;

  const remaining = expiryTime - Date.now();
  const timeDisplay = document.getElementById('time-left');

  if (!timeDisplay) return;

  if (remaining <= 0) {
    timeDisplay.textContent = 'Expired';
    timeDisplay.style.color = '#f43f5e';
    if (countdownInterval) {
      clearInterval(countdownInterval);
    }
    return;
  }

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  if (minutes > 0) {
    timeDisplay.textContent = `${minutes}m`;
  } else {
    timeDisplay.textContent = `${seconds}s`;
    timeDisplay.style.color = '#f59e0b';
  }
}

// ========================================
// Toast Notifications
// ========================================

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');
  const toastIcon = toast.querySelector('.toast-icon');

  toastMessage.textContent = message;
  toastIcon.textContent = type === 'error' ? '✗' : '✓';
  toastIcon.style.color = type === 'error' ? '#f43f5e' : '#10b981';

  toast.classList.remove('hidden');

  // Force reflow for animation
  toast.offsetHeight;

  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 400);
  }, 3000);
}

// ========================================
// Initialize Application
// ========================================

document.addEventListener('DOMContentLoaded', () => {
  // Initialize theme
  initTheme();

  // Initialize quotes
  initQuote();

  // Restore session if exists
  const savedEmail = sessionStorage.getItem('tempEmail');
  const savedCreatedAt = sessionStorage.getItem('emailCreatedAt');

  if (savedEmail && savedCreatedAt) {
    const elapsed = Date.now() - parseInt(savedCreatedAt);

    // Only restore if not expired (1 hour)
    if (elapsed < 3600000) {
      currentEmail = savedEmail;

      document.getElementById('email-address').textContent = currentEmail;
      document.getElementById('no-email').classList.add('hidden');
      document.getElementById('current-email').classList.remove('hidden');
      document.getElementById('welcome-screen').classList.add('hidden');
      document.getElementById('inbox-view').classList.remove('hidden');

      document.getElementById('auto-refresh').checked = true;
      toggleAutoRefresh();
      startExpiryCountdown();
      checkEmails();
    } else {
      // Session expired, clear it
      sessionStorage.removeItem('tempEmail');
      sessionStorage.removeItem('emailCreatedAt');
    }
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd + N = New email
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    generateEmail();
  }

  // Escape = Close email viewer
  if (e.key === 'Escape' && selectedEmailIndex >= 0) {
    closeEmail();
  }

  // R = Refresh
  if (e.key === 'r' && !e.ctrlKey && !e.metaKey && currentEmail) {
    checkEmails();
    showToast('🔄 Refreshed');
  }
});
