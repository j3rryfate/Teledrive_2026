// public/main.js
let currentFolder = 'Uncategorized';
let loginId = null;

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `fixed bottom-4 right-4 px-6 py-3 rounded shadow-lg text-white ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 4000);
}

async function checkLogin() {
  const res = await fetch('/api/files', { credentials: 'include' });
  if (res.status === 401) {
    document.getElementById('login-section').classList.remove('hidden');
    document.getElementById('main-content').classList.add('hidden');
  } else {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('main-content').classList.remove('hidden');
    loadFolders();
    loadFiles();
  }
}

async function sendCode() {
  const phone = document.getElementById('phone').value.trim();
  if (!phone) return showToast('ဖုန်းနံပါတ် ထည့်ပါ', 'error');

  try {
    const res = await fetch('/api/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();
    if (data.loginId) {
      loginId = data.loginId;
      document.getElementById('step-phone').classList.add('hidden');
      document.getElementById('step-code').classList.remove('hidden');
      showToast('OTP ပို့ပြီးပါပြီ');
    }
  } catch (err) {
    showToast('အမှားတစ်ခု ဖြစ်သွားပါပြီ', 'error');
  }
}

async function verifyCode() {
  const code = document.getElementById('code').value.trim();
  if (!code) return showToast('OTP ထည့်ပါ', 'error');

  try {
    const res = await fetch('/api/auth/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginId, code })
    });
    const data = await res.json();

    if (data.status === '2fa_required') {
      document.getElementById('step-code').classList.add('hidden');
      document.getElementById('step-2fa').classList.remove('hidden');
      showToast('2FA Password ထည့်ပါ');
    } else if (data.success) {
      showToast('Login အောင်မြင်ပါပြီ ✓');
      checkLogin();
    }
  } catch (err) {
    showToast('OTP မမှန်ပါ', 'error');
  }
}

async function verify2FA() {
  const password = document.getElementById('password').value.trim();
  if (!password) return showToast('Password ထည့်ပါ', 'error');

  try {
    const res = await fetch('/api/auth/verify-2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginId, password })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Login အောင်မြင်ပါပြီ ✓');
      checkLogin();
    }
  } catch (err) {
    showToast('2FA မမှန်ပါ', 'error');
  }
}

// Folders & Files loading (အရင်ဗားရှင်းအတိုင်း)
async function loadFolders() {
  const res = await fetch('/api/folders', { credentials: 'include' });
  const folders = await res.json();

  const list = document.getElementById('folder-list');
  const select = document.getElementById('upload-folder');
  list.innerHTML = '';
  select.innerHTML = '';

  folders.forEach(f => {
    const li = document.createElement('li');
    li.innerHTML = `<button class="w-full text-left px-4 py-2 rounded hover:bg-gray-100 ${f === currentFolder ? 'bg-indigo-100 text-indigo-700' : ''}" onclick="loadFiles('${f}')">${f}</button>`;
    list.appendChild(li);

    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f;
    if (f === 'Uncategorized') opt.selected = true;
    select.appendChild(opt);
  });
}

async function loadFiles(folder = 'Uncategorized') {
  currentFolder = folder;
  document.getElementById('current-folder').textContent = folder;

  const res = await fetch(`/api/files?folder=${encodeURIComponent(folder)}`, { credentials: 'include' });
  const files = await res.json();

  const grid = document.getElementById('files-grid');
  grid.innerHTML = files.length === 0 ? '<p class="text-center text-gray-500 col-span-full py-10">ဖိုင်မရှိသေးပါ</p>' : '';

  files.forEach(file => {
    const isVideo = file.mimeType?.startsWith('video/');
    const card = document.createElement('div');
    card.className = 'bg-white rounded-lg shadow border overflow-hidden hover:shadow-md';
    card.innerHTML = `
      <div class="p-4">
        <h4 class="font-medium truncate">${file.fileName}</h4>
        <p class="text-xs text-gray-500">${new Date(file.date * 1000).toLocaleDateString()} • ${(file.size / 1024 / 1024).toFixed(2)} MB</p>
      </div>
      ${isVideo ? `<video src="/api/stream/${file.messageId}" controls class="w-full h-40 object-cover bg-black"></video>` :
        file.mimeType?.startsWith('image/') ? `<img src="/api/stream/${file.messageId}" class="w-full h-40 object-cover">` :
        `<div class="h-40 bg-gray-100 flex items-center justify-center text-5xl text-gray-400">📄</div>`}
      <div class="p-4">
        <select onchange="moveFile(${file.messageId}, this.value)" class="text-sm border rounded px-2 py-1 w-full">
          <option>Folder ပြောင်းရန်...</option>
        </select>
        <a href="/api/stream/${file.messageId}?download=1" download="${file.fileName}" class="block mt-3 text-center bg-gray-100 hover:bg-gray-200 py-2 rounded text-sm">
          Download
        </a>
      </div>
    `;
    grid.appendChild(card);
  });

  // Populate move dropdown
  document.querySelectorAll('select[onchange^="moveFile"]').forEach(sel => {
    folders.forEach(f => {
      if (f !== currentFolder) {
        const opt = document.createElement('option');
        opt.value = f;
        opt.textContent = f;
        sel.appendChild(opt);
      }
    });
  });
}

async function uploadFile() {
  const file = document.getElementById('file-input').files[0];
  const folder = document.getElementById('upload-folder').value;
  if (!file) return showToast('ဖိုင်ရွေးပါ', 'error');

  const formData = new FormData();
  formData.append('file', file);
  formData.append('folder', folder);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData, credentials: 'include' });
    if (res.ok) {
      showToast('တင်ပြီးပါပြီ');
      loadFiles(currentFolder);
    } else {
      showToast('တင်မရပါ', 'error');
    }
  } catch (err) {
    showToast('အမှားတစ်ခု ဖြစ်သွားပါပြီ', 'error');
  }
}

async function moveFile(messageId, newFolder) {
  if (!newFolder) return;
  try {
    const res = await fetch('/api/move', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, folder: newFolder }),
      credentials: 'include'
    });
    if (res.ok) {
      showToast(`Moved to ${newFolder}`);
      loadFiles(currentFolder);
    }
  } catch (err) {
    showToast('ရွှေ့လို့ မရပါ', 'error');
  }
}

document.getElementById('sync-btn')?.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/sync', { method: 'POST', credentials: 'include' });
    const { synced } = await res.json();
    showToast(`Synced ${synced} files`);
    loadFolders();
    loadFiles(currentFolder);
  } catch (err) {
    showToast('Sync မအောင်မြင်ပါ', 'error');
  }
});

window.onload = checkLogin;
