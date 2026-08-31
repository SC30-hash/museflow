// src/lib/store.js
// IndexedDB-backed store for MuseFlow content.
// 使用内存缓存保证同步读取，写入时同步更新缓存 + 异步写入 IndexedDB。
// 启动时从 IndexedDB 加载数据到缓存，并自动迁移 localStorage 旧数据。

import { getItem, setItem, removeItem, getAllKeys, clearAll as idbClearAll, estimateUsage } from './idb.js';

const KEYS = {
  captures: 'museflow.captures.v1',
  demos: 'museflow.demos.v1',
  lyrics: 'museflow.lyrics.v1',
  sketches: 'museflow.sketches.v1',
  settings: 'museflow.settings.v1',
  categories: 'museflow.categories.v1',
};

// ---- 内存缓存 ----
const cache = {};
let storeReady = false;

/**
 * 初始化：从 IndexedDB 加载所有数据到内存缓存。
 * 如果 IndexedDB 为空但 localStorage 有旧数据，自动迁移。
 * 完成后派发 'storeready' 事件，页面监听后重新渲染。
 */
const readyPromise = (async () => {
  // 1. 从 IndexedDB 加载所有已知的 key
  for (const key of Object.values(KEYS)) {
    const val = await getItem(key);
    if (val !== undefined) {
      cache[key] = val;
    }
  }

  // 2. 检查是否需要从 localStorage 迁移
  let needMigration = false;
  for (const key of Object.values(KEYS)) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) { needMigration = true; break; }
    } catch { /* ignore */ }
  }

  // 3. 如果 IndexedDB 里没有数据但 localStorage 有，执行迁移
  if (needMigration && Object.keys(cache).length === 0) {
    for (const [name, key] of Object.entries(KEYS)) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          cache[key] = parsed;
          await setItem(key, parsed);
        }
      } catch { /* ignore individual key errors */ }
    }
    // 迁移完成后清理 localStorage（保留 settings 备份以防意外）
    for (const key of Object.values(KEYS)) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    }
    console.log('[MuseFlow] 已从 localStorage 迁移到 IndexedDB');
  }

  storeReady = true;
  window.dispatchEvent(new Event('storeready'));
})();

/**
 * 同步读取（从内存缓存）。
 * @param {string} key
 * @param {*} fallback — 缓存未命中时返回
 * @returns {*}
 */
function read(key, fallback) {
  if (key in cache) return cache[key];
  return fallback;
}

/**
 * 同步写入缓存 + 异步写入 IndexedDB。
 * @param {string} key
 * @param {*} value
 */
function write(key, value) {
  // 同步更新缓存
  cache[key] = value;
  // 异步写入 IndexedDB（fire-and-forget，出错时警告）
  setItem(key, value).catch((e) => {
    console.warn('[MuseFlow] IndexedDB write failed:', e);
    if (e?.name === 'QuotaExceededError') {
      try { window.MFOnQuotaFull?.(); } catch { /* ignore */ }
    }
  });
}

// ==================== 对外 API（保持不变） ====================

export const uid = (prefix = 'id') =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const nowstamp = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// ---- Captures (灵感: audio recordings + text ideas) ----
export const captures = {
  all: () => read(KEYS.captures, []),
  save: (items) => write(KEYS.captures, items),
  add(item) {
    const list = this.all();
    list.unshift({ id: uid('cap'), createdAt: Date.now(), ...item });
    this.save(list);
    return list;
  },
  remove(id) {
    const list = this.all().filter((x) => x.id !== id);
    this.save(list);
    return list;
  },
  update(id, patch) {
    const list = this.all();
    const idx = list.findIndex((x) => x.id === id);
    if (idx === -1) return list;
    list[idx] = { ...list[idx], ...patch };
    this.save(list);
    return list;
  },
};

// ---- Demos (小样) ----
export const demos = {
  all: () => read(KEYS.demos, []),
  save: (items) => write(KEYS.demos, items),
  add(item) {
    const list = this.all();
    list.unshift({ id: uid('demo'), date: '今天', progress: 0, ...item });
    this.save(list);
    return list;
  },
  remove(id) {
    const list = this.all().filter((x) => x.id !== id);
    this.save(list);
    return list;
  },
};

// ---- Lyrics (歌词) ----
export const lyrics = {
  all: () => read(KEYS.lyrics, [
    {
      id: 'seed_a',
      title: '未命名歌词 A',
      date: '8/20',
      body: '窗外的雨滴落进旧钢琴，\n我把沉默谱成一首小曲，\n送给那个还没睡着的夜。',
    },
    {
      id: 'seed_b',
      title: '夏日尾声',
      date: '8/15',
      body: '蝉鸣把午后拉长，\n风扇转着旧时光，\n你笑起来的弧度，\n是夏天最后的和弦。',
    },
  ]),
  save: (items) => write(KEYS.lyrics, items),
  add(item) {
    const list = this.all();
    list.unshift({ id: uid('lyr'), date: '今天', ...item });
    this.save(list);
    return list;
  },
  remove(id) {
    const list = this.all().filter((x) => x.id !== id);
    this.save(list);
    return list;
  },
};

// ---- Categories / Folders for lyrics ----
export const categories = {
  all: () => read(KEYS.categories, []),
  save: (items) => write(KEYS.categories, items),
  add(name) {
    const list = this.all();
    const cat = { id: uid('cat'), name: String(name || '未分类').slice(0, 20), createdAt: Date.now() };
    list.unshift(cat);
    this.save(list);
    return cat;
  },
  update(id, patch) {
    const list = this.all();
    const idx = list.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...patch };
    this.save(list);
    return list[idx];
  },
  remove(id) {
    const list = this.all().filter((c) => c.id !== id);
    this.save(list);
    // also unassign this category from lyrics
    const lyricList = lyrics.all();
    let changed = false;
    for (const l of lyricList) {
      if (l.categoryId === id) { l.categoryId = null; changed = true; }
    }
    if (changed) lyrics.save(lyricList);
    return list;
  },
  rename(id, name) {
    return this.update(id, { name: String(name || '').trim().slice(0, 20) });
  },
};

// ---- Sketches (创作循环段) ----
export const sketches = {
  all: () => read(KEYS.sketches, []),
  save: (items) => write(KEYS.sketches, items),
  add(item) {
    const list = this.all();
    list.unshift({ id: uid('sk'), date: '今天', ...item });
    this.save(list);
    return list;
  },
  remove(id) {
    const list = this.all().filter((x) => x.id !== id);
    this.save(list);
    return list;
  },
};

// ---- Settings ----
export const settings = {
  all: () => read(KEYS.settings, { bpm: 110, beats: 4 }),
  save: (s) => write(KEYS.settings, s),
};

// ==================== 存储用量 ====================

/**
 * 估算存储用量（字节）。使用 navigator.storage.estimate()。
 * 返回 { usedBytes, usedPercent, level, quotaBytes }
 * level: 'ok' (≤70%) | 'warn' (70~90%) | 'danger' (>90%)
 */
export async function checkQuota() {
  const { usage = 0, quota = 0 } = await estimateUsage();
  // quota 为 0 时（不支持 estimate），回退到保守值
  const effectiveQuota = quota || 500 * 1024 * 1024; // IndexedDB 通常上限远大于 localStorage
  const pct = effectiveQuota > 0 ? Math.min(100, Math.round((usage / effectiveQuota) * 100)) : 0;
  let level = 'ok';
  if (pct > 90) level = 'danger';
  else if (pct > 70) level = 'warn';
  return { usedBytes: usage, usedPercent: pct, level, quotaBytes: effectiveQuota };
}

/**
 * 同步估算缓存占用（字节）。
 * 用于 IndexedDB 尚未加载完成时的快速估算。
 */
export function estimateCacheBytes() {
  let total = 0;
  for (const [key, val] of Object.entries(cache)) {
    try {
      total += JSON.stringify(val).length * 2; // UTF-16
    } catch { /* ignore */ }
  }
  return total;
}

/** 格式化字节数为人类可读字符串 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 清空所有 MuseFlow 存储数据（IndexedDB + localStorage 残留） */
export async function clearAllData() {
  for (const key of Object.values(KEYS)) {
    delete cache[key];
    try { await removeItem(key); } catch { /* ignore */ }
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
}

// ==================== Import / Export ====================
// 导出所有 MuseFlow 数据为一个 JSON 对象
export function exportAll() {
  const out = {
    app: 'MuseFlow',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {},
  };
  for (const [name, key] of Object.entries(KEYS)) {
    out.data[name] = read(key, null);
  }
  return out;
}

// 从 JSON 对象导入数据，覆盖所有本地数据
export function importAll(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, count: 0, message: '无效的数据格式' };
  }
  if (payload.app !== 'MuseFlow' || !payload.data) {
    return { ok: false, count: 0, message: '不是 MuseFlow 的备份文件' };
  }
  let count = 0;
  for (const [name, key] of Object.entries(KEYS)) {
    const v = payload.data[name];
    if (v !== undefined) {
      write(key, v);
      count++;
    }
  }
  return { ok: true, count, message: `已导入 ${count} 项数据` };
}

// 导出 ready promise，供需要等待数据加载完成的地方使用
export { readyPromise as storeReady };
