// src/pages/lyrics.js
// 歌词 page: quick add with autosave hint, a list of lyrics cards, an inline
// modal editor, and .txt export of selected drafts.

import { refreshIcons } from '../lib/nav.js';
import { lyrics } from '../lib/store.js';

const toastEl = document.getElementById('toast');
let toastTimer = null;
window.MFToast = (msg) => {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
};

const titleInput = document.getElementById('lyric-title');
const bodyInput = document.getElementById('lyric-line');
const saveBtn = document.getElementById('save-btn');
const newBtn = document.getElementById('new-btn');
const listEl = document.getElementById('lyrics-list');
const countEl = document.getElementById('lyrics-count');
const autoLabel = document.getElementById('auto-save-label');

const lyricsToggleSelectBtn = document.getElementById('lyrics-toggle-select');
const lyricsSelectBar = document.getElementById('lyrics-select-bar');
const lyricsSelectAll = document.getElementById('lyrics-select-all');
const lyricsSelectedCount = document.getElementById('lyrics-selected-count');
const lyricsBatchDeleteBtn = document.getElementById('lyrics-batch-delete');
const lyricsSelectCancelBtn = document.getElementById('lyrics-select-cancel');

let lyricsSelectMode = false;
let lyricsSelected = new Set();

// ================== 确认弹框（通用） ==================
const confirmModal = document.getElementById('confirm-modal');
const confirmMessage = document.getElementById('confirm-message');
let confirmResolver = null;
function openConfirm(message) {
  confirmMessage.textContent = message || '确认继续？';
  confirmModal.style.display = 'flex';
  refreshIcons();
  return new Promise((resolve) => { confirmResolver = resolve; });
}
function closeConfirm(result) {
  confirmModal.style.display = 'none';
  if (confirmResolver) { confirmResolver(!!result); confirmResolver = null; }
}
document.getElementById('confirm-cancel')?.addEventListener('click', () => closeConfirm(false));
document.getElementById('confirm-ok')?.addEventListener('click', () => closeConfirm(true));
confirmModal?.addEventListener('click', (e) => { if (e.target === confirmModal) closeConfirm(false); });
document.addEventListener('keydown', (e) => {
  if (confirmModal && confirmModal.style.display === 'flex') {
    if (e.key === 'Escape') closeConfirm(false);
    if (e.key === 'Enter') closeConfirm(true);
  }
});

function updateLyricsSelectUI() {
  const items = lyrics.all();
  if (!lyricsSelectMode) {
    lyricsSelectBar?.classList.add('hidden');
    lyricsToggleSelectBtn?.classList.remove('bg-muted', 'text-foreground');
  } else {
    lyricsSelectBar?.classList.remove('hidden');
    lyricsToggleSelectBtn?.classList.add('bg-muted', 'text-foreground');
  }
  if (lyricsSelectedCount) lyricsSelectedCount.textContent = `已选 ${lyricsSelected.size} 项`;
  if (lyricsBatchDeleteBtn) lyricsBatchDeleteBtn.disabled = lyricsSelected.size === 0;
  if (lyricsSelectAll) {
    lyricsSelectAll.checked = items.length > 0 && lyricsSelected.size === items.length;
    lyricsSelectAll.indeterminate = lyricsSelected.size > 0 && lyricsSelected.size < items.length;
  }
}

function exitLyricsSelectMode() {
  lyricsSelectMode = false;
  lyricsSelected.clear();
  const items = lyrics.all();
  lyricsSelectBar?.classList.add('hidden');
  lyricsToggleSelectBtn?.classList.remove('bg-muted', 'text-foreground');
  if (lyricsSelectedCount) lyricsSelectedCount.textContent = '已选 0 项';
  if (lyricsBatchDeleteBtn) lyricsBatchDeleteBtn.disabled = true;
  if (lyricsSelectAll) { lyricsSelectAll.checked = false; lyricsSelectAll.indeterminate = false; }
  if (items.length === 0) return;
  render();
}

function lyricCheckbox(checked, id) {
  return `
    <label class="shrink-0 w-5 h-5 rounded-md border-2 border-border flex items-center justify-center cursor-pointer hover:border-primary transition-colors ${checked ? 'bg-primary border-primary' : ''}" data-lyric-check="${id}" onclick="event.stopPropagation()">
      <i data-lucide="check" class="w-3.5 h-3.5 ${checked ? 'text-primary-foreground' : 'text-transparent'}"></i>
    </label>`;
}

// Quick add
saveBtn.addEventListener('click', () => {
  const body = bodyInput.value.trim();
  if (!body) { window.MFToast('先写一句再保存'); return; }
  const title = titleInput.value.trim() || body.split('\n')[0].slice(0, 12);
  lyrics.add({ title, body });
  titleInput.value = '';
  bodyInput.value = '';
  window.MFToast('已保存到手稿');
  render();
});

newBtn.addEventListener('click', () => {
  titleInput.focus();
  bodyInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// Autosave hint — live character count + "已自动暂存" feedback
let autosaveTimer = null;
function scheduleAutosave() {
  autoLabel.textContent = '编辑中…';
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autoLabel.textContent = '已自动暂存';
  }, 600);
}
bodyInput.addEventListener('input', scheduleAutosave);
titleInput.addEventListener('input', scheduleAutosave);

// Ctrl/Cmd+Enter to save
bodyInput.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') saveBtn.click();
});

// List
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function preview(body) {
  return escapeHtml(body).replace(/\\n/g, '\n').replace(/\n/g, '<br />');
}

let editingId = null;
const modal = document.getElementById('editor-modal');
const editTitle = document.getElementById('edit-title');
const editBody = document.getElementById('edit-body');
const editSave = document.getElementById('edit-save');

function render() {
  const items = lyrics.all();
  countEl.textContent = items.length ? `${items.length} 篇` : '';
  if (!items.length) {
    exitLyricsSelectMode();
    listEl.innerHTML = `
      <div class="py-10 flex flex-col items-center text-center text-muted-foreground">
        <div class="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-3">
          <i data-lucide="align-left" class="w-7 h-7"></i>
        </div>
        <p class="text-sm">还没有手稿，写第一句吧</p>
      </div>`;
    refreshIcons();
    return;
  }
  listEl.innerHTML = items
    .map((it) => {
      const checked = lyricsSelected.has(it.id);
      return `
      <article class="bg-card border ${checked ? 'border-primary ring-2 ring-primary/30' : 'border-border'} rounded-xl p-4 shadow-sm hover:shadow-md transition-all duration-150" data-id="${it.id}">
        <div class="flex items-start justify-between gap-3">
          ${lyricsSelectMode ? lyricCheckbox(checked, it.id) : ''}
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-3">
              <h3 class="text-sm font-medium truncate">${escapeHtml(it.title)}</h3>
              <span class="text-xs text-muted-foreground shrink-0">${escapeHtml(it.date)}</span>
            </div>
            <p class="mt-2 text-sm text-muted-foreground leading-relaxed line-clamp-3">${preview(it.body)}</p>
            ${lyricsSelectMode ? '' : `
            <div class="mt-3 flex flex-wrap gap-2 items-center">
              <button type="button" data-action="edit" class="px-2 py-1 rounded-md bg-muted text-xs font-medium text-muted-foreground hover:text-foreground transition-colors duration-150">编辑</button>
              <button type="button" data-action="export" class="px-2 py-1 rounded-md bg-muted text-xs font-medium text-muted-foreground hover:text-foreground transition-colors duration-150">导出</button>
              <button type="button" data-action="delete" class="px-2 py-1 rounded-md bg-muted text-xs font-medium text-muted-foreground hover:text-foreground transition-colors duration-150 ml-auto">删除</button>
            </div>`}
          </div>
        </div>
      </article>`;
    })
    .join('');
  updateLyricsSelectUI();
  refreshIcons();
}

// ---- 多选绑定 ----
if (lyricsToggleSelectBtn) {
  lyricsToggleSelectBtn.addEventListener('click', () => {
    const items = lyrics.all();
    if (!items.length) { window.MFToast('暂无可选手稿'); return; }
    lyricsSelectMode = !lyricsSelectMode;
    if (!lyricsSelectMode) lyricsSelected.clear();
    updateLyricsSelectUI();
    render();
  });
}
if (lyricsSelectCancelBtn) {
  lyricsSelectCancelBtn.addEventListener('click', exitLyricsSelectMode);
}
if (lyricsSelectAll) {
  lyricsSelectAll.addEventListener('change', () => {
    const items = lyrics.all();
    if (lyricsSelectAll.checked) lyricsSelected = new Set(items.map((x) => x.id));
    else lyricsSelected.clear();
    updateLyricsSelectUI();
    render();
  });
}
if (lyricsBatchDeleteBtn) {
  lyricsBatchDeleteBtn.addEventListener('click', async () => {
    if (!lyricsSelected.size) return;
    const ok = await openConfirm(`确定删除选中的 ${lyricsSelected.size} 篇？此操作不可恢复。`);
    if (!ok) return;
    let n = 0;
    lyricsSelected.forEach((id) => { lyrics.remove(id); n++; });
    window.MFToast(`已删除 ${n} 篇`);
    exitLyricsSelectMode();
  });
}
// 复选框点击（委托）
listEl.addEventListener('click', (e) => {
  if (!lyricsSelectMode) return;
  const el = e.target.closest('[data-lyric-check]');
  if (!el) return;
  const id = el.dataset.lyricCheck;
  if (lyricsSelected.has(id)) lyricsSelected.delete(id);
  else lyricsSelected.add(id);
  updateLyricsSelectUI();
  render();
});

listEl.addEventListener('click', (e) => {
  if (lyricsSelectMode) return;
  const article = e.target.closest('article[data-id]');
  if (!article) return;
  const id = article.dataset.id;
  const action = e.target.closest('button[data-action]')?.dataset.action;
  const item = lyrics.all().find((x) => x.id === id);
  if (!item) return;
  if (action === 'edit') openEditor(item);
  else if (action === 'delete') {
    lyrics.remove(id);
    window.MFToast('已删除');
    render();
  } else if (action === 'export') exportLyric(item);
});

function openEditor(item) {
  editingId = item.id;
  editTitle.value = item.title;
  editBody.value = item.body;
  modal.classList.remove('hidden');
  editBody.focus();
}
function closeModal() {
  modal.classList.add('hidden');
  editingId = null;
}
modal.addEventListener('click', (e) => {
  if (e.target.matches('[data-close]') || e.target.closest('[data-close]')) closeModal();
});
editSave.addEventListener('click', () => {
  if (!editingId) return;
  const list = lyrics.all();
  const item = list.find((x) => x.id === editingId);
  if (!item) return;
  item.title = editTitle.value.trim() || '未命名歌词';
  item.body = editBody.value;
  lyrics.save(list);
  closeModal();
  window.MFToast('已更新');
  render();
});

function exportLyric(item) {
  const content = `${item.title}\n\n${item.body}\n`;
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${item.title || '未命名歌词'}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  window.MFToast('已导出 .txt');
}

// Init
// mountNav is called by app.js
render();
