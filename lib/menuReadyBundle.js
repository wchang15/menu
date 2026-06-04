'use client';

import { del, get, set, keys as idbKeys } from 'idb-keyval';

const MENU_READY_BUNDLE_PREFIX = 'MENU_READY_BUNDLE_V2';
const MENU_READY_BUNDLE_VERSION = 2;
const MENU_READY_BUNDLE_MAX_AGE_MS = 1000 * 60 * 90;
const WINDOW_READY_BUNDLE_STORE = '__MENU_READY_BUNDLES_V1__';
const memoryBundles = new Map();

export function menuReadyBundleIdentity(language, userId) {
  const safeLang = language === 'ko' ? 'ko' : 'en';
  return `${userId || 'user'}:${safeLang}`;
}

function bundleKey(language, userId) {
  return `${MENU_READY_BUNDLE_PREFIX}:${menuReadyBundleIdentity(language, userId)}`;
}

function getWindowStore() {
  if (typeof window === 'undefined') return null;
  try {
    if (!window[WINDOW_READY_BUNDLE_STORE]) {
      window[WINDOW_READY_BUNDLE_STORE] = new Map();
    }
    return window[WINDOW_READY_BUNDLE_STORE];
  } catch {
    return null;
  }
}

function readMemoryBundle(key, language, userId = null) {
  const memoryBundle = memoryBundles.get(key);
  if (isFreshBundle(memoryBundle, language, userId)) {
    const windowStore = getWindowStore();
    try {
      windowStore?.set?.(key, memoryBundle);
    } catch {
      // ignore memory mirror failures
    }
    return memoryBundle;
  }

  const windowStore = getWindowStore();
  const windowBundle = windowStore?.get?.(key);
  if (isFreshBundle(windowBundle, language, userId)) {
    memoryBundles.set(key, windowBundle);
    return windowBundle;
  }

  return null;
}

function writeMemoryBundle(key, bundle) {
  if (!key || !bundle) return;
  memoryBundles.set(key, bundle);
  const windowStore = getWindowStore();
  try {
    windowStore?.set?.(key, bundle);
  } catch {
    // ignore memory mirror failures
  }
}

function normalizeLanguageProbeText(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^\$?\s*\d+(?:[.,]\d+)?\s*$/.test(text)) return '';
  if (/^(음식\s*이름|음식명|가격|item\s*name|price)$/i.test(text)) return '';
  return text;
}

function inferLayoutLanguage(layout) {
  const profile = (Array.isArray(layout?.items) ? layout.items : [])
    .filter((item) => item?.type === 'text')
    .map((item) => normalizeLanguageProbeText(item.text))
    .filter(Boolean)
    .reduce((acc, text) => {
      const hangulChars = text.match(/[가-힣]/g)?.length || 0;
      const latinChars = text.match(/[A-Za-z]/g)?.length || 0;
      if (hangulChars > 0) {
        acc.koItems += 1;
        acc.koChars += hangulChars;
      }
      if (latinChars > 0) {
        acc.enItems += 1;
        acc.enChars += latinChars;
      }
      return acc;
    }, { koItems: 0, enItems: 0, koChars: 0, enChars: 0 });

  const { koItems, enItems, koChars, enChars } = profile;
  if (!koItems && !enItems) return null;
  if (koItems >= 3 && koItems >= enItems * 1.35) return 'ko';
  if (enItems >= 3 && enItems >= koItems * 1.35) return 'en';
  if (koChars >= 12 && koChars >= enChars * 0.7) return 'ko';
  if (enChars >= 12 && enChars >= koChars * 1.15) return 'en';
  if (koItems > enItems) return 'ko';
  if (enItems > koItems) return 'en';
  return null;
}

function isFreshBundle(value, language, userId = null) {
  if (!value || typeof value !== 'object') return false;
  if (value.version !== MENU_READY_BUNDLE_VERSION) return false;
  if (value.language !== (language === 'ko' ? 'ko' : 'en')) return false;
  if ((value.userId || null) !== (userId || null)) return false;
  if (!value.layout || typeof value.layout !== 'object') return false;

  const items = Array.isArray(value.layout.items) ? value.layout.items : [];
  const inferredLanguage = inferLayoutLanguage(value.layout);
  if (inferredLanguage) {
    if (inferredLanguage !== (language === 'ko' ? 'ko' : 'en')) return false;
  }

  const mediaItems = items.filter((item) => item && (item.type === 'image' || item.type === 'video'));
  const unresolvedMedia = mediaItems.some((item) => {
    const src = typeof item.src === 'string' ? item.src : '';
    return (item.assetPath && (!src || src.startsWith('blob:'))) || (!item.assetPath && src.startsWith('blob:'));
  });
  if (unresolvedMedia) return false;

  const imageUrlCount = new Set(
    items
      .filter((item) => item?.type === 'image' && item?.src)
      .map((item) => item.src)
      .filter(Boolean)
  ).size;
  const stats = value.imagePreloadStats || null;
  if (imageUrlCount > 0) {
    const total = Number(stats?.total || 0);
    const loaded = Number(stats?.loaded || 0);
    const failed = Number(stats?.failed || 0);
    if (!stats || total < imageUrlCount || loaded < total || failed > 0) return false;
  }

  if (value.layout?.mode === 'custom') {
    const hasBackground =
      !!value.bgSignedUrl ||
      Object.keys(value.bgOverrideSignedUrls || {}).length > 0;
    if (!hasBackground) return false;
  }

  const ts = Number(value.ts || 0);
  if (!ts || Date.now() - ts > MENU_READY_BUNDLE_MAX_AGE_MS) return false;

  return true;
}

function readKey(key, language, userId = null) {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return null;

  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return isFreshBundle(parsed, language, userId) ? parsed : null;
  } catch {
    return null;
  }
}

export function readMenuReadyBundle(language, userId) {
  if (!userId) return null;
  const exactKey = bundleKey(language, userId);
  const memoryExact = readMemoryBundle(exactKey, language, userId);
  if (memoryExact) return memoryExact;

  const exact = readKey(bundleKey(language, userId), language, userId);
  if (exact) {
    writeMemoryBundle(exactKey, exact);
    return exact;
  }

  return null;
}

export async function readMenuReadyBundleAsync(language, userId) {
  if (!userId) return null;
  const syncBundle = readMenuReadyBundle(language, userId);
  if (syncBundle) return syncBundle;

  const exactKey = bundleKey(language, userId);
  try {
    const exact = await get(exactKey);
    if (isFreshBundle(exact, language, userId)) {
      writeMemoryBundle(exactKey, exact);
      return exact;
    }
  } catch {}

  return null;
}

export function writeMenuReadyBundle({
  language,
  userId,
  layout,
  bgSignedUrl = null,
  bgOverrideSignedUrls = {},
  imagePreloadStats = null,
}) {
  if (!userId) return null;
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return null;
  if (!layout || typeof layout !== 'object') return null;

  const safeLang = language === 'ko' ? 'ko' : 'en';
  const bundle = {
    version: MENU_READY_BUNDLE_VERSION,
    language: safeLang,
    userId: userId || null,
    ts: Date.now(),
    layout,
    bgSignedUrl,
    bgOverrideSignedUrls: bgOverrideSignedUrls || {},
    imagePreloadStats,
  };

  writeMemoryBundle(bundleKey(safeLang, userId), bundle);

  try {
    sessionStorage.setItem(bundleKey(safeLang, userId), JSON.stringify(bundle));
  } catch {
    return bundle;
  }

  return bundle;
}

export async function writeMenuReadyBundleAsync(options) {
  const bundle = writeMenuReadyBundle(options);
  if (!bundle) return null;

  const safeLang = options?.language === 'ko' ? 'ko' : 'en';
  const userId = options?.userId || null;

  try {
    await set(bundleKey(safeLang, userId), bundle);
  } catch {}

  return bundle;
}

export async function clearMenuReadyBundles() {
  memoryBundles.clear();

  try {
    const windowStore = getWindowStore();
    windowStore?.clear?.();
  } catch {}

  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(MENU_READY_BUNDLE_PREFIX)) {
        sessionStorage.removeItem(key);
      }
    }
  } catch {}

  try {
    const allKeys = await idbKeys();
    await Promise.all(
      allKeys
        .filter((key) => typeof key === 'string' && key.startsWith(MENU_READY_BUNDLE_PREFIX))
        .map((key) => del(key))
    );
  } catch (error) {
    console.error('clearMenuReadyBundles failed', error);
  }
}
