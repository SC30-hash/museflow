// src/app.js — SPA entry point
// Imports all page modules and mounts the shared nav.

import { mountNav } from './lib/nav.js';
import { exportAll, importAll, checkQuota, formatBytes } from './lib/store.js';
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
  renderQuotaInfo();
  settingsModal?.classList.remove('hidden');
  createIcons({ icons: lucideIcons });
}
function closeSettings() {
  settingsModal?.classList.add('hidden');
}

// ---- 存储用量进度条 ----
function renderQuotaInfo() {
  const info = checkQuota();
  const bar = document.getElementById('quota-bar');
  const text = document.getElementById('quota-text');
  const hint = document.getElementById('quota-hint');
  if (!bar || !text || !hint) return;

  // 进度条颜色 + 提示文案
  const barColor = info.level === 'danger'
    ? 'bg-red-500'
    : info.level === 'warn'
      ? 'bg-amber-500'
      : 'bg-primary';
  bar.className = `h-full transition-all duration-500 ${barColor}`;
  bar.style.width = info.usedPercent + '%';

  text.textContent = `${formatBytes(info.usedBytes)} / 5MB (${info.usedPercent}%)`;

  // 顶部状态图标颜色
  const quotaCard = document.getElementById('quota-card');
  const icon = quotaCard?.querySelector('[data-lucide="database"]');
  if (icon) {
    const color = info.level === 'danger'
      ? 'text-red-500'
      : info.level === 'warn'
        ? 'text-amber-500'
        : 'text-muted-foreground';
    icon.className = `w-4 h-4 ${color}`;
  }

  // 底部提示
  hint.classList.remove('hidden');
  if (info.level === 'danger') {
    hint.innerHTML = '<span class="text-red-500 font-medium">⚠ 存储空间即将用完</span>，建议立即导出备份后清理数据';
  } else if (info.level === 'warn') {
    hint.innerHTML = '<span class="text-amber-500">·</span> 已使用超过 70%，导出备份以防数据丢失';
  } else {
    hint.innerHTML = '<span class="text-muted-foreground">·</span> 存储状态良好';
  }
}

// ---- 启动时检查配额，超过 70% 弹一次提醒 ----
(function startupQuotaCheck() {
  // 上次提醒时间，避免每次打开都弹窗
  const LAST_REMIND_KEY = 'museflow.lastQuotaRemind';
  const MIN_REMIND_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 小时

  try {
    const info = checkQuota();
    if (info.level === 'ok') return;

    const lastRemind = Number(localStorage.getItem(LAST_REMIND_KEY) || 0);
    const now = Date.now();
    if (now - lastRemind < MIN_REMIND_INTERVAL_MS) return;
    localStorage.setItem(LAST_REMIND_KEY, String(now));

    const toast = window.MFToast;
    const click = () => { openSettings(); };
    if (toast) {
      // 用 toast + setTimeout 后注入"打开设置"链接式按钮
      toast(info.level === 'danger'
        ? '存储空间即将用完，请导出备份 →'
        : '存储空间已用超过 70%，建议导出备份 →');
      // 延迟挂载点击打开设置
      setTimeout(() => {
        const toastEl = document.getElementById('toast');
        if (toastEl) toastEl.style.cursor = 'pointer';
      }, 0);
      // 让用户能点 toast 打开设置：监听一次 toast 点击
      const toastEl = document.getElementById('toast');
      if (toastEl) {
        const handler = () => { click(); toastEl.removeEventListener('click', handler); };
        toastEl.addEventListener('click', handler);
      }
    }
  } catch { /* ignore */ }
})();

// ---- 存储满事件：任何 store.write 触发 QuotaExceededError 时自动打开设置弹窗 ----
let quotaFullCooldownUntil = 0;
window.MFOnQuotaFull = () => {
  const now = Date.now();
  if (now < quotaFullCooldownUntil) return;
  quotaFullCooldownUntil = now + 5000; // 5s 冷却，避免连续写入反复弹窗
  const toast = window.MFToast;
  if (toast) toast('存储空间已满，请立即导出备份！');
  // 延迟打开设置，让 toast 先显示
  setTimeout(() => openSettings(), 400);
};

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
