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
    // Quota / private mode — fail silently.
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
