// src/lib/nav.js
// SPA view switcher — all views live in a single index.html.
// Tab switching is instant via show/hide, no page navigation, no URL change.

import { createIcons, icons as lucideIcons } from 'lucide';

const VIEWS = [
  { key: 'capture', label: '灵感', icon: 'mic',        subtitle: '捕捉一闪而过的旋律',            actions: ['search']        },
  { key: 'demos',   label: '小样', icon: 'music',      subtitle: '上传音频，自动检测调式与 BPM', actions: ['search']        },
  { key: 'lyrics',  label: '歌词', icon: 'align-left', subtitle: '写下你的句子',                  actions: ['search', 'new'] },
];

let currentKey = null;

function icon(name, cls = 'w-5 h-5 shrink-0') {
  const i = document.createElement('i');
  i.setAttribute('data-lucide', name);
  i.className = cls;
  return i;
}

// ---- Build header action button(s) ----
// Each view can define multiple action buttons, plus a gear/settings button always present.
function buildHeaderAction(actions) {
  const container = document.getElementById('header-action');
  if (!container) return;
  container.innerHTML = '';
  const list = Array.isArray(actions) ? actions : (actions ? [actions] : []);
  for (const actionType of list) {
    if (actionType === 'search') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'search-btn';
      btn.className = 'p-2 rounded-full hover:bg-muted transition-colors duration-150';
      btn.setAttribute('aria-label', '搜索');
      btn.appendChild(icon('search', 'w-5 h-5 text-muted-foreground'));
      container.appendChild(btn);
    } else if (actionType === 'new') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'new-btn';
      btn.className = 'p-2 rounded-full hover:bg-muted transition-colors duration-150';
      btn.setAttribute('aria-label', '新建');
      btn.appendChild(icon('plus', 'w-5 h-5 text-muted-foreground'));
      container.appendChild(btn);
    }
  }
  // Settings gear (import/export data) — present on every view
  const gear = document.createElement('button');
  gear.type = 'button';
  gear.id = 'settings-btn';
  gear.className = 'p-2 rounded-full hover:bg-muted transition-colors duration-150';
  gear.setAttribute('aria-label', '数据与设置');
  gear.appendChild(icon('settings', 'w-5 h-5 text-muted-foreground'));
  container.appendChild(gear);
}

// ---- Update header content for a view ----
function updateHeader(key) {
  const view = VIEWS.find(v => v.key === key);
  if (!view) return;

  const iconEl = document.getElementById('header-icon');
  if (iconEl) {
    iconEl.setAttribute('data-lucide', view.icon);
    // lucide replaces <i> with <svg>, so we need to rebuild
    const newI = document.createElement('i');
    newI.id = 'header-icon';
    newI.setAttribute('data-lucide', view.icon);
    newI.className = 'w-6 h-6 text-primary';
    iconEl.replaceWith(newI);
  }

  const titleEl = document.getElementById('header-title');
  if (titleEl) titleEl.textContent = view.label;

  const subEl = document.getElementById('header-subtitle');
  if (subEl) subEl.textContent = view.subtitle;

  buildHeaderAction(view.actions);
  document.title = `${view.label} - MuseFlow`;
}

// ---- Show/hide views ----
function showView(key) {
  document.querySelectorAll('main[data-view]').forEach(el => {
    el.classList.toggle('hidden', el.getAttribute('data-view') !== key);
  });
}

// ---- Mobile bottom nav ----
function buildMobileNav(activeKey) {
  const nav = document.createElement('nav');
  nav.setAttribute('data-mobile-nav', 'global');
  nav.className =
    'nav-floating fixed bottom-0 left-1/2 -translate-x-1/2 z-40 ' +
    'w-full max-w-[28rem] px-2 ' +
    'pb-[calc(var(--museflow-safe-bottom)+8px)] pt-2';

  const pill = document.createElement('div');
  pill.className =
    'nav-pill relative flex items-center justify-around ' +
    'w-full ' +
    'bg-card border border-border rounded-2xl ' +
    'shadow-[0_-4px_24px_-8px_rgba(0,0,0,0.5)]';

  const indicator = document.createElement('div');
  indicator.className = 'nav-indicator absolute rounded-xl';
  pill.appendChild(indicator);

  for (const v of VIEWS) {
    const a = document.createElement('a');
    a.href = '#';
    a.setAttribute('data-nav-key', v.key);
    const isActive = v.key === activeKey;
    a.className =
      'nav-item relative flex flex-col items-center justify-center ' +
      'gap-0.5 px-4 py-1.5 rounded-xl z-10 ' +
      (isActive
        ? 'nav-item-active text-primary'
        : 'text-muted-foreground hover:text-foreground');
    if (isActive) a.setAttribute('data-active', 'true');

    a.appendChild(icon(v.icon, 'w-[22px] h-[22px] shrink-0'));
    const span = document.createElement('span');
    span.className = 'text-[10px] leading-none whitespace-nowrap tracking-wide';
    span.textContent = v.label;
    a.appendChild(span);
    pill.appendChild(a);
  }

  nav.appendChild(pill);

  requestAnimationFrame(() => {
    updateNavIndicator(activeKey);
  });

  return nav;
}

// ---- Desktop rail ----
function buildRail(activeKey) {
  const rail = document.createElement('aside');
  rail.className = 'app-rail flex-col px-4 py-6 rail-only';
  rail.style.display = 'none';

  const brand = document.createElement('div');
  brand.className = 'flex items-center justify-between mb-8 px-2';
  const mark = document.createElement('a');
  mark.href = '#';
  mark.className = 'brand-mark text-foreground';
  mark.onclick = (e) => { e.preventDefault(); switchView('capture'); };
  const dot = document.createElement('span');
  dot.className = 'brand-dot';
  mark.appendChild(dot);
  const name = document.createElement('span');
  name.textContent = 'MuseFlow';
  mark.appendChild(name);
  brand.appendChild(mark);
  rail.appendChild(brand);

  const list = document.createElement('nav');
  list.setAttribute('aria-label', '主导航');
  list.className = 'flex-1 flex flex-col gap-1';
  for (const v of VIEWS) {
    const a = document.createElement('a');
    a.href = '#';
    a.setAttribute('data-nav-key', v.key);
    const isActive = v.key === activeKey;
    a.className =
      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 ' +
      (isActive
        ? 'bg-primary/10 text-primary font-medium'
        : 'text-muted-foreground hover:text-foreground hover:bg-muted');
    a.appendChild(icon(v.icon, 'w-[18px] h-[18px] shrink-0'));
    const labels = document.createElement('span');
    labels.className = 'flex flex-col leading-tight';
    const t = document.createElement('span');
    t.textContent = v.label;
    labels.appendChild(t);
    const s = document.createElement('span');
    s.className = 'text-[11px] text-muted-foreground/80';
    s.textContent = v.subtitle;
    labels.appendChild(s);
    a.appendChild(labels);
    list.appendChild(a);
  }
  rail.appendChild(list);

  const foot = document.createElement('div');
  foot.className = 'mt-6 pt-4 border-t border-border text-[11px] text-muted-foreground/80 px-2';
  foot.textContent = 'MuseFlow · v1.0 — 灵感不止';
  rail.appendChild(foot);

  return rail;
}

// ---- Update nav indicator position ----
function updateNavIndicator(key) {
  const pill = document.querySelector('.nav-pill');
  if (!pill) return;

  const active = pill.querySelector(`[data-nav-key="${key}"]`);
  const indicator = pill.querySelector('.nav-indicator');
  if (!active || !indicator) return;

  const r = active.getBoundingClientRect();
  const pr = pill.getBoundingClientRect();
  indicator.style.left = (r.left - pr.left) + 'px';
  indicator.style.top = (r.top - pr.top) + 'px';
  indicator.style.width = r.width + 'px';
  indicator.style.height = r.height + 'px';
}

// ---- Switch view (the core SPA function) ----
export function switchView(key) {
  const view = VIEWS.find(v => v.key === key);
  if (!view || key === currentKey) return;

  // Update views
  showView(key);
  updateHeader(key);

  // Update nav active states
  document.querySelectorAll('[data-nav-key]').forEach(el => {
    const isActive = el.getAttribute('data-nav-key') === key;
    el.classList.toggle('nav-item-active', isActive);
    el.classList.toggle('text-primary', isActive);
    el.classList.toggle('text-muted-foreground', !isActive);
    if (isActive) el.setAttribute('data-active', 'true');
    else el.removeAttribute('data-active');
  });

  // Update desktop rail active states
  document.querySelectorAll('.app-rail [data-nav-key]').forEach(el => {
    const isActive = el.getAttribute('data-nav-key') === key;
    el.classList.toggle('bg-primary/10', isActive);
    el.classList.toggle('text-primary', isActive);
    el.classList.toggle('font-medium', isActive);
    el.classList.toggle('text-muted-foreground', !isActive);
  });

  updateNavIndicator(key);
  createIcons({ icons: lucideIcons });
  currentKey = key;
}

// expose globally so search modal (defined in capture.js) can navigate
window.MFNavigate = switchView;

// ---- Mount nav (called once on page load) ----
export function mountNav(activeKey) {
  currentKey = activeKey;

  const shell = document.getElementById('app-shell');
  if (!shell) return;

  // Remove any previous nav elements
  shell.querySelectorAll('.app-rail, [data-mobile-nav]').forEach(n => n.remove());

  const rail = buildRail(activeKey);
  shell.appendChild(rail);

  const frame = document.querySelector('.page-frame');
  if (frame) {
    frame.appendChild(buildMobileNav(activeKey));
  }

  createIcons({ icons: lucideIcons });

  // Intercept nav clicks
  setupNavInterception();

  // Show initial view
  showView(activeKey);
  updateHeader(activeKey);

  // updateHeader() replaces #header-icon with a fresh <i> placeholder that
  // hasn't been processed by lucide yet, so we must re-run createIcons AFTER
  // updateHeader to actually render the header logo. Without this, the logo
  // stays blank on initial load and only appears after the first view switch
  // (switchView already calls createIcons at its end, which masked the bug).
  createIcons({ icons: lucideIcons });

  // Re-position indicator after layout settles
  requestAnimationFrame(() => updateNavIndicator(activeKey));
}

// ---- Nav click interception ----
function setupNavInterception() {
  if (window.__spaNavBound) return;
  window.__spaNavBound = true;

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-nav-key]');
    if (!a) return;
    e.preventDefault();
    const key = a.getAttribute('data-nav-key');
    switchView(key);
  });
}

// ---- Helpers ----
export function refreshIcons() {
  createIcons({ icons: lucideIcons });
}

export function swapIcon(container, name) {
  if (!container) return;
  const existing = container.querySelector('svg.lucide, i[data-lucide]');
  if (!existing) return;
  const raw = existing.getAttribute('class') || '';
  const kept = raw
    .split(/\s+/)
    .filter((c) => c && !c.startsWith('lucide'))
    .join(' ');
  const i = document.createElement('i');
  i.setAttribute('data-lucide', name);
  i.className = kept;
  existing.replaceWith(i);
  createIcons({ icons: lucideIcons });
}
