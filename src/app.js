// src/app.js — SPA entry point
// Imports all page modules and mounts the shared nav.

import { mountNav } from './lib/nav.js';
import { exportAll, importAll } from './lib/store.js';
import { createIcons, icons as lucideIcons } from 'lucide';

// Import page modules — their top-level code initializes DOM elements,
// event listeners, and list rendering for all three views.
import './pages/capture.js';
import './pages/demos.js';
import './pages/lyrics.js';

// Mount the shared navigation and show the initial view.
mountNav('capture');

// ================== Settings modal (import / export data) ==================
const settingsModal = document.getElementById('settings-modal');

function openSettings() {
  settingsModal?.classList.remove('hidden');
  createIcons({ icons: lucideIcons });
}
function closeSettings() {
  settingsModal?.classList.add('hidden');
}

// Event delegation for the settings gear button (dynamically created by nav.js)
document.addEventListener('click', (e) => {
  if (e.target.closest('#settings-btn')) { openSettings(); }
});

// Close handlers
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close-settings]')) closeSettings();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsModal && !settingsModal.classList.contains('hidden')) closeSettings();
});

// Export
document.getElementById('export-all-btn')?.addEventListener('click', () => {
  const payload = exportAll();
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const ts = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const fname = `museflow-backup-${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}.json`;
  const a = document.createElement('a');
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  window.MFToast ? window.MFToast('已导出备份：' + fname) : alert('已导出备份：' + fname);
});

// Import
const importFileInput = document.getElementById('import-file-input');
document.getElementById('import-all-btn')?.addEventListener('click', () => importFileInput?.click());
importFileInput?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const result = importAll(payload);
    if (!result.ok) {
      window.MFToast ? window.MFToast('导入失败：' + result.message) : alert('导入失败：' + result.message);
      return;
    }
    // 提示用户刷新页面以载入新数据
    const toast = window.MFToast;
    if (toast) toast(result.message + '，即将刷新…');
    else alert(result.message + '，即将刷新…');
    setTimeout(() => { location.reload(); }, 1200);
  } catch (err) {
    window.MFToast ? window.MFToast('导入失败：文件损坏或格式错误') : alert('导入失败：文件损坏或格式错误');
  }
});
