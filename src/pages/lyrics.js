// src/pages/lyrics.js
// 歌词 page: 分类文件夹管理 + 快速保存 + 卡片列表 + 内联编辑器 + .txt 导出

import { refreshIcons } from '../lib/nav.js';
import { lyrics, categories } from '../lib/store.js';

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

// 分类筛选栏 + 新建分类按钮
const catBar = document.getElementById('lyric-cat-bar');
const newCatQuickBtn = document.getElementById('new-cat-quick');

// 快速保存时的分类选择器
const newLyricCatBtn = document.getElementById('new-lyric-cat-btn');
const newLyricCatLabel = document.getElementById('new-lyric-cat-label');
const newLyricCatMenu = document.getElementById('new-lyric-cat-menu');

// 当前选中的筛选分类：null = 全部, 'uncat' = 未分类, cat id = 具体分类
let activeFilter = null;
// 快速保存时默认的分类
let defaultNewCatId = null;

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

// ================== 多选模式 ==================
const lyricsToggleSelectBtn = document.getElementById('lyrics-toggle-select');
const lyricsSelectBar = document.getElementById('lyrics-select-bar');
const lyricsSelectAll = document.getElementById('lyrics-select-all');
const lyricsSelectedCount = document.getElementById('lyrics-selected-count');
const lyricsBatchDeleteBtn = document.getElementById('lyrics-batch-delete');
const lyricsSelectCancelBtn = document.getElementById('lyrics-select-cancel');

let lyricsSelectMode = false;
let lyricsSelected = new Set();

function updateLyricsSelectUI() {
  const items = filteredLyrics();
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
  lyricsSelectBar?.classList.add('hidden');
  lyricsToggleSelectBtn?.classList.remove('bg-muted', 'text-foreground');
  if (lyricsSelectedCount) lyricsSelectedCount.textContent = '已选 0 项';
  if (lyricsBatchDeleteBtn) lyricsBatchDeleteBtn.disabled = true;
  if (lyricsSelectAll) { lyricsSelectAll.checked = false; lyricsSelectAll.indeterminate = false; }
  render();
}
function lyricCheckbox(checked, id) {
  return `
    <label class="shrink-0 w-5 h-5 rounded-md border-2 border-border flex items-center justify-center cursor-pointer hover:border-primary transition-colors ${checked ? 'bg-primary border-primary' : ''}" data-lyric-check="${id}" onclick="event.stopPropagation()">
      <i data-lucide="check" class="w-3.5 h-3.5 ${checked ? 'text-primary-foreground' : 'text-transparent'}"></i>
    </label>`;
}

// ================== 工具 ==================
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function preview(body) {
  return escapeHtml(body).replace(/\\n/g, '\n').replace(/\n/g, '<br />');
}
function catById(id) {
  if (!id) return null;
  return categories.all().find((c) => c.id === id) || null;
}

// 按当前筛选条件返回歌词
function filteredLyrics() {
  const all = lyrics.all();
  if (activeFilter === null) return all;
  if (activeFilter === 'uncat') return all.filter((l) => !l.categoryId);
  return all.filter((l) => l.categoryId === activeFilter);
}

// 每个分类的歌词数量
function countByCategory() {
  const counts = new Map();
  for (const l of lyrics.all()) {
    const key = l.categoryId || 'uncat';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

// ================== 分类筛选栏 ==================
function renderCategoryBar() {
  if (!catBar) return;
  const cats = categories.all();
  const counts = countByCategory();
  const totalUncat = counts.get('uncat') || 0;
  const totalAll = lyrics.all().length;

  // "全部" chip
  const allActive = activeFilter === null;
  let html = `
    <button type="button" data-cat-filter="all"
      class="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
        allActive ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'
      }">
      <i data-lucide="list" class="w-3.5 h-3.5"></i>
      全部
      <span class="${allActive ? 'text-primary-foreground/80' : 'text-muted-foreground'}">${totalAll}</span>
    </button>`;

  // 未分类
  if (totalUncat > 0 || cats.length > 0) {
    const uncatActive = activeFilter === 'uncat';
    html += `
      <button type="button" data-cat-filter="uncat"
        class="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
          uncatActive ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'
        }">
        <i data-lucide="folder" class="w-3.5 h-3.5"></i>
        未分类
        <span class="${uncatActive ? 'text-primary-foreground/80' : 'text-muted-foreground'}">${totalUncat}</span>
      </button>`;
  }

  // 用户分类
  for (const cat of cats) {
    const active = activeFilter === cat.id;
    const n = counts.get(cat.id) || 0;
    html += `
      <button type="button" data-cat-filter="${cat.id}"
        class="shrink-0 group flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
          active ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'
        }">
        <i data-lucide="folder" class="w-3.5 h-3.5"></i>
        <span class="max-w-[80px] truncate">${escapeHtml(cat.name)}</span>
        <span class="${active ? 'text-primary-foreground/80' : 'text-muted-foreground'}">${n}</span>
        <i data-lucide="x" data-cat-delete="${cat.id}" class="w-3 h-3 ml-0.5 opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:!text-destructive transition-opacity"></i>
      </button>`;
  }

  // 新建分类（inline input，点击展开）
  html += `
    <button type="button" data-cat-new-open
      class="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all border border-dashed border-border">
      <i data-lucide="plus" class="w-3.5 h-3.5"></i>新建
    </button>
    <span data-cat-new-input-wrap class="hidden shrink-0 flex items-center gap-1">
      <input type="text" data-cat-new-input maxlength="20" placeholder="分类名"
        class="w-24 rounded-full border border-input bg-input px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
      <button type="button" data-cat-new-save class="p-1 rounded-full hover:bg-muted"><i data-lucide="check" class="w-3.5 h-3.5 text-primary"></i></button>
      <button type="button" data-cat-new-cancel class="p-1 rounded-full hover:bg-muted"><i data-lucide="x" class="w-3.5 h-3.5 text-muted-foreground"></i></button>
    </span>`;

  catBar.innerHTML = html;
  refreshIcons();
}

// ================== 分类下拉（快速保存时选分类） ==================
function renderNewLyricCatMenu() {
  if (!newLyricCatMenu) return;
  const cats = categories.all();
  const cur = catById(defaultNewCatId);

  // 更新按钮显示的标签
  if (cur) newLyricCatLabel.textContent = cur.name;
  else newLyricCatLabel.textContent = '未分类';

  let html = `
    <button type="button" data-pick-cat="__none__"
      class="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-muted transition-colors ${
        !defaultNewCatId ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
      }">
      <i data-lucide="folder" class="w-3.5 h-3.5"></i>未分类
      ${!defaultNewCatId ? '<i data-lucide="check" class="w-3.5 h-3.5 ml-auto"></i>' : ''}
    </button>
    <div class="h-px bg-border my-1"></div>`;
  for (const cat of cats) {
    const active = defaultNewCatId === cat.id;
    html += `
      <button type="button" data-pick-cat="${cat.id}"
        class="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-muted transition-colors ${
          active ? 'bg-primary/10 text-primary' : ''
        }">
        <i data-lucide="folder" class="w-3.5 h-3.5 text-primary"></i>
        <span class="truncate">${escapeHtml(cat.name)}</span>
        ${active ? '<i data-lucide="check" class="w-3.5 h-3.5 ml-auto"></i>' : ''}
      </button>`;
  }
  html += `
    <div class="h-px bg-border my-1"></div>
    <button type="button" data-pick-cat-new class="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-muted transition-colors text-muted-foreground">
      <i data-lucide="plus" class="w-3.5 h-3.5"></i>新建分类…
    </button>`;
  newLyricCatMenu.innerHTML = html;
  refreshIcons();
}

// ================== 歌词卡片分类下拉 ==================
function renderCardCatMenu(card) {
  const wrap = card.querySelector('[data-card-cat-menu]');
  if (!wrap) return;
  const currentId = card.dataset.categoryId || null;
  const cats = categories.all();

  let html = '';
  html += `
    <button type="button" data-pick-card-cat="${card.dataset.id}" data-cat="__none__"
      class="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-muted transition-colors ${
        !currentId ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
      }">
      <i data-lucide="folder" class="w-3.5 h-3.5"></i>未分类
      ${!currentId ? '<i data-lucide="check" class="w-3.5 h-3.5 ml-auto"></i>' : ''}
    </button>`;
  if (cats.length > 0) {
    html += `<div class="h-px bg-border my-1"></div>`;
    for (const cat of cats) {
      const active = currentId === cat.id;
      html += `
        <button type="button" data-pick-card-cat="${card.dataset.id}" data-cat="${cat.id}"
          class="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-muted transition-colors ${
            active ? 'bg-primary/10 text-primary' : ''
          }">
          <i data-lucide="folder" class="w-3.5 h-3.5 text-primary"></i>
          <span class="truncate">${escapeHtml(cat.name)}</span>
          ${active ? '<i data-lucide="check" class="w-3.5 h-3.5 ml-auto"></i>' : ''}
        </button>`;
    }
  }
  wrap.innerHTML = html;
  refreshIcons();
}

// ================== 主渲染 ==================
let editingId = null;
const modal = document.getElementById('editor-modal');
const editTitle = document.getElementById('edit-title');
const editBody = document.getElementById('edit-body');
const editSave = document.getElementById('edit-save');

function render() {
  renderCategoryBar();
  renderNewLyricCatMenu();

  const items = filteredLyrics();
  const totalAll = lyrics.all().length;
  if (activeFilter === null) {
    countEl.textContent = totalAll ? `${totalAll} 篇` : '';
  } else {
    countEl.textContent = `${items.length} / ${totalAll} 篇`;
  }

  if (!items.length) {
    exitLyricsSelectMode();
    let hint = '还没有手稿，写第一句吧';
    if (activeFilter === 'uncat') hint = '没有未分类的手稿';
    else if (activeFilter) hint = '这个分类里还没有手稿';

    listEl.innerHTML = `
      <div class="py-10 flex flex-col items-center text-center text-muted-foreground">
        <div class="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-3">
          <i data-lucide="align-left" class="w-7 h-7"></i>
        </div>
        <p class="text-sm">${hint}</p>
      </div>`;
    refreshIcons();
    return;
  }

  listEl.innerHTML = items
    .map((it) => {
      const checked = lyricsSelected.has(it.id);
      const catName = catById(it.categoryId)?.name;
      return `
      <article class="bg-card border ${checked ? 'border-primary ring-2 ring-primary/30' : 'border-border'} rounded-xl p-4 shadow-sm hover:shadow-md transition-all duration-150" data-id="${it.id}" data-category-id="${it.categoryId || ''}">
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
              ${catName ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium"><i data-lucide="folder" class="w-2.5 h-2.5"></i>${escapeHtml(catName)}</span>` : ''}
              <!-- 移动到分类 -->
              <div class="relative">
                <button type="button" data-action="move-cat" class="px-2 py-1 rounded-md bg-muted text-xs font-medium text-muted-foreground hover:text-foreground transition-colors duration-150 inline-flex items-center gap-1">
                  <i data-lucide="folder-plus" class="w-3 h-3"></i>移动
                </button>
                <div data-card-cat-menu class="hidden absolute left-0 bottom-full mb-1 w-44 rounded-lg border border-border bg-card shadow-lg z-20 py-1"></div>
              </div>
              <button type="button" data-action="edit" class="px-2 py-1 rounded-md bg-muted text-xs font-medium text-muted-foreground hover:text-foreground transition-colors duration-150">编辑</button>
              <button type="button" data-action="export" class="px-2 py-1 rounded-md bg-muted text-xs font-medium text-muted-foreground hover:text-foreground transition-colors duration-150">导出</button>
              <button type="button" data-action="delete" class="px-2 py-1 rounded-md bg-muted text-xs font-medium text-muted-foreground hover:text-foreground transition-colors duration-150 ml-auto">删除</button>
            </div>`}
          </div>
        </div>
      </article>`;
    })
    .join('');

  // 打开已请求的"移动到分类"下拉
  listEl.querySelectorAll('[data-action="move-cat"][data-open-menu]').forEach((btn) => {
    btn.removeAttribute('data-open-menu');
    const wrap = btn.closest('article');
    const menu = btn.parentElement.querySelector('[data-card-cat-menu]');
    if (menu) {
      menu.classList.remove('hidden');
      renderCardCatMenu(wrap);
    }
  });

  updateLyricsSelectUI();
  refreshIcons();
}

// ================== 事件绑定 ==================

// Quick add — 带分类
saveBtn?.addEventListener('click', () => {
  const body = bodyInput.value.trim();
  if (!body) { window.MFToast('先写一句再保存'); return; }
  const title = titleInput.value.trim() || body.split('\n')[0].slice(0, 12);
  lyrics.add({ title, body, categoryId: defaultNewCatId || null });
  titleInput.value = '';
  bodyInput.value = '';
  window.MFToast(defaultNewCatId ? `已保存到「${catById(defaultNewCatId)?.name}」` : '已保存到手稿');
  render();
});

// new-btn → 页面顶部的 "+" 按钮（动态创建，委托）
document.addEventListener('click', (e) => {
  if (!e.target.closest('#new-btn')) return;
  titleInput?.focus();
  bodyInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// Autosave hint
let autosaveTimer = null;
function scheduleAutosave() {
  autoLabel.textContent = '编辑中…';
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => { autoLabel.textContent = '已自动暂存'; }, 600);
}
bodyInput?.addEventListener('input', scheduleAutosave);
titleInput?.addEventListener('input', scheduleAutosave);

// Ctrl/Cmd+Enter to save
bodyInput?.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') saveBtn?.click();
});

// ---- 分类栏事件（委托）----
catBar?.addEventListener('click', async (e) => {
  // 1. 新建分类 input 区域
  const openNew = e.target.closest('[data-cat-new-open]');
  if (openNew) {
    openNew.classList.add('hidden');
    const wrap = catBar.querySelector('[data-cat-new-input-wrap]');
    if (wrap) { wrap.classList.remove('hidden'); wrap.querySelector('[data-cat-new-input]')?.focus(); }
    return;
  }
  const newInput = e.target.closest('[data-cat-new-input]');
  const saveNew = e.target.closest('[data-cat-new-save]');
  const cancelNew = e.target.closest('[data-cat-new-cancel]');
  if (newInput || saveNew) {
    const val = catBar.querySelector('[data-cat-new-input]')?.value?.trim();
    if (saveNew && val) {
      const cat = categories.add(val);
      window.MFToast(`已创建分类「${cat.name}」`);
      defaultNewCatId = cat.id;
      activeFilter = cat.id;
    }
    // 收起新建区
    const wrap = catBar.querySelector('[data-cat-new-input-wrap]');
    if (wrap) { wrap.classList.add('hidden'); wrap.querySelector('input').value = ''; }
    catBar.querySelector('[data-cat-new-open]')?.classList.remove('hidden');
    render();
    return;
  }
  if (cancelNew) {
    const wrap = catBar.querySelector('[data-cat-new-input-wrap]');
    if (wrap) { wrap.classList.add('hidden'); wrap.querySelector('input').value = ''; }
    catBar.querySelector('[data-cat-new-open]')?.classList.remove('hidden');
    return;
  }

  // 2. 删除分类（悬停 × 号）
  const delBtn = e.target.closest('[data-cat-delete]');
  if (delBtn) {
    const id = delBtn.dataset.catDelete;
    const cat = catById(id);
    if (!cat) return;
    e.stopPropagation();
    const ok = await openConfirm(`删除分类「${cat.name}」？分类下的手稿会变成「未分类」。`);
    if (!ok) return;
    categories.remove(id);
    if (activeFilter === id) activeFilter = null;
    if (defaultNewCatId === id) defaultNewCatId = null;
    window.MFToast('已删除分类');
    render();
    return;
  }

  // 3. 筛选切换
  const filterBtn = e.target.closest('[data-cat-filter]');
  if (filterBtn) {
    const val = filterBtn.dataset.catFilter;
    activeFilter = val === 'all' ? null : val;
    exitLyricsSelectMode();
    render();
    return;
  }
});

// 新建分类 input 回车确认
catBar?.addEventListener('keydown', (e) => {
  const input = e.target.closest('[data-cat-new-input]');
  if (!input) return;
  if (e.key === 'Enter') { e.preventDefault(); catBar.querySelector('[data-cat-new-save]')?.click(); }
  else if (e.key === 'Escape') { e.preventDefault(); catBar.querySelector('[data-cat-new-cancel]')?.click(); }
});

// ---- 快速保存分类选择器下拉 ----
newLyricCatBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  // 关闭所有其他下拉
  document.querySelectorAll('[data-card-cat-menu]:not(.hidden)').forEach((m) => m.classList.add('hidden'));
  newLyricCatMenu?.classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
  // 点外面关闭
  if (!e.target.closest('#new-lyric-cat-wrap')) {
    newLyricCatMenu?.classList.add('hidden');
  }
  // 关闭卡片内的分类菜单
  if (!e.target.closest('[data-card-cat-menu]') && !e.target.closest('[data-action="move-cat"]')) {
    document.querySelectorAll('[data-card-cat-menu]:not(.hidden)').forEach((m) => m.classList.add('hidden'));
  }
});
newLyricCatMenu?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-pick-cat]');
  if (btn) {
    const v = btn.dataset.pickCat;
    defaultNewCatId = v === '__none__' ? null : v;
    renderNewLyricCatMenu();
    newLyricCatMenu.classList.add('hidden');
    return;
  }
  const newBtn = e.target.closest('[data-pick-cat-new]');
  if (newBtn) {
    newLyricCatMenu.classList.add('hidden');
    // 在分类栏上展开新建
    catBar?.querySelector('[data-cat-new-open]')?.click();
    return;
  }
});

// ---- 卡片分类下拉委托 ----
listEl?.addEventListener('click', (e) => {
  // 打开 move-cat 菜单
  const moveBtn = e.target.closest('[data-action="move-cat"]');
  if (moveBtn && !lyricsSelectMode) {
    e.stopPropagation();
    // 关闭所有其他菜单
    document.querySelectorAll('[data-card-cat-menu]:not(.hidden)').forEach((m) => {
      if (!moveBtn.parentElement.contains(m)) m.classList.add('hidden');
    });
    newLyricCatMenu?.classList.add('hidden');
    const menu = moveBtn.parentElement.querySelector('[data-card-cat-menu]');
    if (!menu) return;
    menu.classList.toggle('hidden');
    if (!menu.classList.contains('hidden')) {
      renderCardCatMenu(moveBtn.closest('article'));
    }
    return;
  }
  // 选中菜单项
  const pick = e.target.closest('[data-pick-card-cat]');
  if (pick) {
    e.stopPropagation();
    const lyricId = pick.dataset.pickCardCat;
    const catId = pick.dataset.cat === '__none__' ? null : pick.dataset.cat;
    const list = lyrics.all();
    const item = list.find((x) => x.id === lyricId);
    if (item) {
      item.categoryId = catId;
      lyrics.save(list);
      const catName = catById(catId)?.name;
      window.MFToast(catName ? `已移至「${catName}」` : '已移出分类');
    }
    render();
    return;
  }
});

// ---- 多选绑定 ----
if (lyricsToggleSelectBtn) {
  lyricsToggleSelectBtn.addEventListener('click', () => {
    const items = filteredLyrics();
    if (!items.length) { window.MFToast('暂无可选手稿'); return; }
    lyricsSelectMode = !lyricsSelectMode;
    if (!lyricsSelectMode) lyricsSelected.clear();
    updateLyricsSelectUI();
    render();
  });
}
if (lyricsSelectCancelBtn) lyricsSelectCancelBtn.addEventListener('click', exitLyricsSelectMode);
if (lyricsSelectAll) {
  lyricsSelectAll.addEventListener('change', () => {
    const items = filteredLyrics();
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
// 复选框（委托）
listEl?.addEventListener('click', (e) => {
  if (!lyricsSelectMode) return;
  const el = e.target.closest('[data-lyric-check]');
  if (!el) return;
  const id = el.dataset.lyricCheck;
  if (lyricsSelected.has(id)) lyricsSelected.delete(id);
  else lyricsSelected.add(id);
  updateLyricsSelectUI();
  render();
});

// 卡片 actions（编辑 / 删除 / 导出）
listEl?.addEventListener('click', (e) => {
  if (lyricsSelectMode) return;
  const article = e.target.closest('article[data-id]');
  if (!article) return;
  const id = article.dataset.id;
  const action = e.target.closest('button[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'move-cat') return; // handled above
  const item = lyrics.all().find((x) => x.id === id);
  if (!item) return;
  if (action === 'edit') openEditor(item);
  else if (action === 'delete') {
    lyrics.remove(id);
    window.MFToast('已删除');
    render();
  } else if (action === 'export') exportLyric(item);
});

// ================== 编辑器 ==================
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
modal?.addEventListener('click', (e) => {
  if (e.target.matches('[data-close]') || e.target.closest('[data-close]')) closeModal();
});
editSave?.addEventListener('click', () => {
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
render();
