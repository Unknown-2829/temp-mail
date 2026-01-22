let currentEmail = '';
let autoRefreshInterval = null;

async function generateEmail() {
  try {
    const response = await fetch('/api/generate', { method: 'POST' });
    const data = await response.json();
    
    currentEmail = data.email;
    document.getElementById('email-display').textContent = currentEmail;
    document.getElementById('generate-section').classList.add('hidden');
    document.getElementById('email-section').classList.remove('hidden');
    document.getElementById('emails-section').classList.remove('hidden');
    
    // Start auto-refresh
    document.getElementById('auto-refresh').checked = true;
    toggleAutoRefresh();
    
    // Check emails immediately
    checkEmails();
  } catch (error) {
    alert('Error generating email');
  }
}

function copyEmail() {
  navigator.clipboard.writeText(currentEmail);
  const btn = document.getElementById('copy-btn');
  btn.textContent = '✓ Copied!';
  setTimeout(() => {
    btn.textContent = '📋 Copy';
  }, 2000);
}

function deleteEmail() {
  currentEmail = '';
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
  document.getElementById('generate-section').classList.remove('hidden');
  document.getElementById('email-section').classList.add('hidden');
  document.getElementById('emails-section').classList.add('hidden');
  document.getElementById('emails-container').innerHTML = '';
}

async function checkEmails() {
  if (!currentEmail) return;
  
  try {
    const response = await fetch(`/api/emails?address=${currentEmail}`);
    const data = await response.json();
    
    const emails = data.emails || [];
    document.getElementById('email-count').textContent = emails.length;
    
    const container = document.getElementById('emails-container');
    
    if (emails.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12 text-gray-500">
          <div class="text-6xl mb-4">📭</div>
          <p class="text-lg">No emails yet</p>
          <p class="text-sm mt-2">Waiting for incoming emails...</p>
        </div>
      `;
    } else {
      container.innerHTML = emails.map(e => `
        <div class="border-2 border-gray-200 rounded-xl p-6 hover:border-indigo-300 transition-all mb-4">
          <div class="flex justify-between items-start mb-3">
            <h3 class="text-xl font-bold text-gray-800">${escapeHtml(e.subject)}</h3>
            <span class="text-xs text-gray-500">${new Date(e.timestamp).toLocaleString()}</span>
          </div>
          
          <p class="text-sm text-gray-600 mb-3">
            <strong>From:</strong> ${escapeHtml(e.from)}
          </p>
          
          <div class="bg-gray-50 p-4 rounded-lg">
            <pre class="text-sm text-gray-700 whitespace-pre-wrap break-words">${escapeHtml(e.body)}</pre>
          </div>
        </div>
      `).join('');
    }
  } catch (error) {
    console.error('Error checking emails:', error);
  }
}

function toggleAutoRefresh() {
  const checked = document.getElementById('auto-refresh').checked;
  
  if (checked) {
    autoRefreshInterval = setInterval(checkEmails, 5000);
  } else {
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
