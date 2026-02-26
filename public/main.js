// public/main.js
let currentFolder = 'Uncategorized';

async function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `fixed bottom-4 right-4 px-6 py-3 rounded shadow-lg text-white ${
    type === 'success' ? 'bg-green-600' : 'bg-red-600'
  }`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 4000);
}

async function loadFolders() {
  const res = await fetch('/api/folders');
  const folders = await res.json();

  const list = document.getElementById('folder-list');
  const select = document.getElementById('upload-folder');
  list.innerHTML = '';
  select.innerHTML = '';

  folders.forEach(folder => {
    // Sidebar
    const li = document.createElement('li');
    li.innerHTML = `
      <button class="w-full text-left px-4 py-2 rounded hover:bg-gray-100 ${folder === currentFolder ? 'bg-indigo-100 text-indigo-700 font-medium' : ''}"
              onclick="loadFiles('${folder}')">
        ${folder}
      </button>
    `;
    list.appendChild(li);

    // Upload dropdown
    const opt = document.createElement('option');
    opt.value = folder;
    opt.textContent = folder;
    if (folder === 'Uncategorized') opt.selected = true;
    select.appendChild(opt);
  });
}

async function loadFiles(folder = 'Uncategorized') {
  currentFolder = folder;
  document.getElementById('current-folder').textContent = folder;

  const res = await fetch(`/api/files?folder=${encodeURIComponent(folder)}`);
  const files = await res.json();

  const grid = document.getElementById('files-grid');
  grid.innerHTML = '';

  if (files.length === 0) {
    grid.innerHTML = '<p class="text-center text-gray-500 col-span-full py-10">ဖိုင်မရှိသေးပါ</p>';
    return;
  }

  files.forEach(file => {
    const isVideo = file.mimeType?.startsWith('video/');
    const card = document.createElement('div');
    card.className = 'bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition';
    card.innerHTML = `
      <div class="p-4">
        <h4 class="font-medium truncate" title="${file.fileName}">${file.fileName}</h4>
        <p class="text-xs text-gray-500 mt-1">
          ${new Date(file.date * 1000).toLocaleDateString()} • ${(file.size / 1024 / 1024).toFixed(2)} MB
        </p>
      </div>

      ${isVideo ? `
        <video src="/api/stream/${file.messageId}" controls class="w-full h-40 object-cover bg-black"></video>
      ` : file.mimeType?.startsWith('image/') ? `
        <img src="/api/stream/${file.messageId}" alt="${file.fileName}" class="w-full h-40 object-cover">
      ` : `
        <div class="h-40 bg-gray-100 flex items-center justify-center text-gray-400">
          <span class="text-5xl">📄</span>
        </div>
      `}

      <div class="p-4 flex flex-col gap-3">
        <div class="flex items-center gap-2">
          <select onchange="moveFile(${file.messageId}, this.value)" class="text-sm border rounded px-2 py-1 flex-1">
            <option value="">Move to folder...</option>
            <!-- Folders တွေ ထပ်ထည့်မယ် (load တဲ့အခါ ထပ်ဖြည့်ပါ) -->
          </select>
        </div>
        <a href="/api/stream/${file.messageId}?download=1" download="${file.fileName}"
           class="text-center bg-gray-100 hover:bg-gray-200 text-gray-800 py-2 rounded text-sm">
          Download
        </a>
      </div>
    `;
    grid.appendChild(card);
  });

  // Move dropdown မှာ folders ထည့်ဖို့
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
  const fileInput = document.getElementById('file-input');
  const folderSelect = document.getElementById('upload-folder');
  if (!fileInput.files[0]) return showToast('ဖိုင်ရွေးပါ', 'error');

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('folder', folderSelect.value);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    if (res.ok) {
      showToast('Upload အောင်မြင်ပါပြီ ✓');
      loadFiles(currentFolder);
      fileInput.value = '';
    } else {
      showToast('Upload မအောင်မြင်ပါ', 'error');
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
      body: JSON.stringify({ messageId, folder: newFolder })
    });
    if (res.ok) {
      showToast(`Moved to ${newFolder} ✓`);
      loadFiles(currentFolder);
    }
  } catch (err) {
    showToast('ရွှေ့လို့ မရပါ', 'error');
  }
}

async function syncChannel() {
  try {
    const res = await fetch('/api/sync', { method: 'POST' });
    const { synced } = await res.json();
    showToast(`Synced ${synced} files ✓`);
    loadFolders();
    loadFiles(currentFolder);
  } catch (err) {
    showToast('Sync မအောင်မြင်ပါ', 'error');
  }
}

// Event Listeners
document.getElementById('sync-btn').onclick = syncChannel;

// Init
window.onload = async () => {
  await loadFolders();
  await loadFiles('Uncategorized');
};