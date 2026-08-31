// src/lib/store.js
// Tiny localStorage-backed store for MuseFlow content.
// Holds captures (灵感), demos (小样), and lyrics (歌词) so the app feels alive
// across page navigations and reloads without a backend.

const KEYS = {
  captures: 'museflow.captures.v1',
  demos: 'museflow.demos.v1',
  lyrics: 'museflow.lyrics.v1',
  sketches: 'museflow.sketches.v1',
  settings: 'museflow.settings.v1',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // QuotaExceededError / NS_ERROR_DOM_QUOTA_REACHED — 存储满了
    if (e?.name === 'QuotaExceededError' || e?.code === 22 || /quota/i.test(e?.message || '')) {
      const err = new Error('localStorage 存储空间不足，请导出备份后清理数据');
      err.isQuotaFull = true;
      // 通知上层有存储满事件（app.js 注册回调）
      try { window.MFOnQuotaFull?.(); } catch { /* ignore */ }
      throw err;
    }
    // 隐私模式 / 其他异常 — 静默吞掉
    console.warn('MuseFlow store: write failed', e);
  }
}

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

// ---- Storage quota helpers ----
// localStorage 按 UTF-16 存储，每个字符 2 字节。
// 实际浏览器上限通常是 5MB ~ 10MB，但不同浏览器/隐私模式差异大，这里取保守值 5MB。
const QUOTA_BYTES = 5 * 1024 * 1024;

function bytesUsedBy(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return 0;
    // JS 字符串是 UTF-16，每个字符 2 字节
    return raw.length * 2;
  } catch {
    return 0;
  }
}

/**
 * 估算当前站点 localStorage 总占用（字节）。
 * 遍历所有 key 统计，兼容隐私模式下的异常。
 */
export function estimateStorageUsage() {
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) total += bytesUsedBy(k);
    }
    return total;
  } catch {
    return 0;
  }
}

/** 格式化字节数为人类可读字符串 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * 检查存储用量，返回 { usedBytes, usedPercent, level }
 * level: 'ok' (≤70%) | 'warn' (70~90%) | 'danger' (>90%)
 */
export function checkQuota() {
  const used = estimateStorageUsage();
  const pct = Math.min(100, Math.round((used / QUOTA_BYTES) * 100));
  let level = 'ok';
  if (pct > 90) level = 'danger';
  else if (pct > 70) level = 'warn';
  return { usedBytes: used, usedPercent: pct, level };
}

/** 清空所有 MuseFlow 存储数据（用于清理） */
export function clearAllData() {
  for (const key of Object.values(KEYS)) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
}

// ---- Import / Export (cross-device sync) ----
// 导出所有 MuseFlow 数据为一个 JSON 对象（不含音频 blob，blob 已在保存工程时转 dataURL）
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

// 从 JSON 对象导入数据，覆盖所有本地数据。返回 { ok, count, message }
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
