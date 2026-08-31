// src/lib/idb.js
// IndexedDB Promise 封装 — 简洁的 key-value API，替代 localStorage
// 支持存储大容量数据（几百 MB~GB），可直接存 Blob/ArrayBuffer

const DB_NAME = 'museflow';
const DB_VERSION = 1;
const STORE_NAME = 'kv'; // key-value store

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/**
 * 读取一个 key 的值（Promise）
 * @param {string} key
 * @returns {Promise<any>} 反序列化后的值，不存在时返回 undefined
 */
export async function getItem(key) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

/**
 * 写入一个 key-value（Promise）
 * @param {string} key
 * @param {any} value — 可直接存对象、数组、Blob、ArrayBuffer
 * @returns {Promise<void>}
 */
export async function setItem(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * 删除一个 key
 * @param {string} key
 * @returns {Promise<void>}
 */
export async function removeItem(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 获取所有 keys
 * @returns {Promise<string[]>}
 */
export async function getAllKeys() {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAllKeys();
      req.onsuccess = () => resolve(req.result.map(k => String(k)));
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/**
 * 清空整个 store
 * @returns {Promise<void>}
 */
export async function clearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 估算存储用量（使用 navigator.storage.estimate）
 * 返回 { usage, quota } 字节
 * 如果浏览器不支持，返回 { usage: 0, quota: 0 }
 */
export async function estimateUsage() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      return { usage, quota };
    }
  } catch { /* ignore */ }
  return { usage: 0, quota: 0 };
}
