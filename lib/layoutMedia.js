'use client';

import { downloadAssetBlobByPath, uploadAsset } from '@/lib/cloudAssets';
import { supabase } from '@/lib/supabaseClient';

const BUCKET = 'assets';
const SIGNED_URL_TTL = 60 * 60 * 24 * 7;
const SESSION_SIGNED_URL_MAX_AGE_MS = 1000 * 60 * 60 * 24;

const signedUrlCache = new Map();
const objectUrlCache = new Map();
const pendingSignedUrlRequests = new Map();

function cloneLayout(layout) {
  return {
    ...(layout || {}),
    items: Array.isArray(layout?.items) ? layout.items.map((item) => ({ ...item })) : [],
  };
}

function isDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:');
}

function isBlobUrl(value) {
  return typeof value === 'string' && value.startsWith('blob:');
}

function canUseSessionStorage() {
  return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined';
}

function canUseLocalStorage() {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function readStoredSignedUrl(storage, assetPath) {
  try {
    const raw = storage.getItem(`signed:${assetPath}`) || null;
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const ts = Number(parsed?.ts || 0);
    const url = typeof parsed?.url === 'string' ? parsed.url : null;

    if (!url || !ts) return null;
    if (Date.now() - ts > SESSION_SIGNED_URL_MAX_AGE_MS) return null;

    return url;
  } catch {
    return null;
  }
}

function getSessionSignedUrl(assetPath) {
  if (!assetPath) return null;
  const sessionCached = canUseSessionStorage() ? readStoredSignedUrl(sessionStorage, assetPath) : null;
  if (sessionCached) return sessionCached;
  return canUseLocalStorage() ? readStoredSignedUrl(localStorage, assetPath) : null;
}

function setSessionSignedUrl(assetPath, url) {
  if (!assetPath || !url) return;
  try {
    const payload = JSON.stringify({ url, ts: Date.now() });
    if (canUseSessionStorage()) sessionStorage.setItem(`signed:${assetPath}`, payload);
    if (canUseLocalStorage()) localStorage.setItem(`signed:${assetPath}`, payload);
  } catch {}
}

function getObjectUrlForAssetPath(assetPath) {
  return objectUrlCache.get(assetPath) || null;
}

function setObjectUrlForAssetPath(assetPath, url) {
  if (!assetPath || !url) return;

  const previous = objectUrlCache.get(assetPath);
  if (previous && previous !== url && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    try {
      URL.revokeObjectURL(previous);
    } catch {}
  }

  objectUrlCache.set(assetPath, url);
}

function isFileRuntime() {
  if (typeof window === 'undefined') return false;

  const protocol = window.location?.protocol || '';
  return protocol === 'file:';
}

function shouldPreferObjectUrl(assetPath) {
  return isFileRuntime();
}

async function createObjectUrlFallbackForAssetPath(assetPath) {
  if (!assetPath || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;

  const cached = getObjectUrlForAssetPath(assetPath);
  if (cached) return cached;

  try {
    const blob = await downloadAssetBlobByPath(assetPath);
    if (!blob) return null;

    const objectUrl = URL.createObjectURL(blob);
    setObjectUrlForAssetPath(assetPath, objectUrl);
    return objectUrl;
  } catch {
    return null;
  }
}

async function resolveRenderableMediaUrl(assetPath, expiresInSec = SIGNED_URL_TTL) {
  if (shouldPreferObjectUrl(assetPath)) {
    const objectUrl = await createObjectUrlFallbackForAssetPath(assetPath);
    if (objectUrl) return objectUrl;
  }

  const signedUrl = await createSignedUrlForAssetPath(assetPath, expiresInSec);
  if (signedUrl) return signedUrl;

  return createObjectUrlFallbackForAssetPath(assetPath);
}

export function sanitizeLayoutMedia(layout) {
  const next = cloneLayout(layout);

  next.items = next.items.map((item) => {
    if (!item || (item.type !== 'image' && item.type !== 'video')) return item;

    const cloned = { ...item };

    if (cloned.assetPath) {
      delete cloned.src;
      delete cloned.localSrc;
    }

    return cloned;
  });

  return next;
}

export async function createSignedUrlForAssetPath(assetPath, expiresInSec = SIGNED_URL_TTL) {
  if (!assetPath) return null;

  const memoryCached = signedUrlCache.get(assetPath);
  if (memoryCached) return memoryCached;

  const sessionCached = getSessionSignedUrl(assetPath);
  if (sessionCached) {
    signedUrlCache.set(assetPath, sessionCached);
    return sessionCached;
  }

  if (pendingSignedUrlRequests.has(assetPath)) {
    return pendingSignedUrlRequests.get(assetPath);
  }

  const request = (async () => {
    try {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(assetPath, expiresInSec);

      if (error) return null;

      const signedUrl = data?.signedUrl || null;
      if (signedUrl) {
        signedUrlCache.set(assetPath, signedUrl);
        setSessionSignedUrl(assetPath, signedUrl);
      }

      return signedUrl;
    } catch {
      return null;
    } finally {
      pendingSignedUrlRequests.delete(assetPath);
    }
  })();

  pendingSignedUrlRequests.set(assetPath, request);
  return request;
}

async function createSignedUrlsForAssetPaths(assetPaths, expiresInSec = SIGNED_URL_TTL) {
  const uniquePaths = Array.from(new Set((assetPaths || []).filter(Boolean)));
  const resolved = new Map();
  const missing = [];

  for (const assetPath of uniquePaths) {
    const memoryCached = signedUrlCache.get(assetPath);
    if (memoryCached) {
      resolved.set(assetPath, memoryCached);
      continue;
    }

    const sessionCached = getSessionSignedUrl(assetPath);
    if (sessionCached) {
      signedUrlCache.set(assetPath, sessionCached);
      resolved.set(assetPath, sessionCached);
      continue;
    }

    missing.push(assetPath);
  }

  if (!missing.length) return resolved;

  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(missing, expiresInSec);

    if (!error && Array.isArray(data)) {
      data.forEach((entry, index) => {
        const assetPath = entry?.path || missing[index];
        const signedUrl = entry?.signedUrl || null;
        if (!assetPath || !signedUrl) return;

        signedUrlCache.set(assetPath, signedUrl);
        setSessionSignedUrl(assetPath, signedUrl);
        resolved.set(assetPath, signedUrl);
      });
    }
  } catch {
    // Fall back below for any paths the batch request did not resolve.
  }

  await Promise.all(
    missing.map(async (assetPath) => {
      if (resolved.has(assetPath)) return;
      const signedUrl = await createSignedUrlForAssetPath(assetPath, expiresInSec);
      if (signedUrl) resolved.set(assetPath, signedUrl);
    })
  );

  return resolved;
}

export async function uploadMenuMediaFile(file, { kind = 'media' } = {}) {
  if (!file) return null;

  const assetPath = await uploadAsset({
    assetKey: `menu_media_${kind}`,
    file,
    contentType: file?.type || undefined,
  });

  const signedUrl = await resolveRenderableMediaUrl(assetPath);
  return { assetPath, signedUrl };
}

export async function hydrateLayoutMedia(layout) {
  const next = cloneLayout(layout);
  const assetPaths = next.items
    .filter((item) => item && (item.type === 'image' || item.type === 'video') && item.assetPath)
    .map((item) => item.assetPath);
  const signedUrls = await createSignedUrlsForAssetPaths(assetPaths);

  next.items = await Promise.all(
    next.items.map(async (item) => {
      if (!item || (item.type !== 'image' && item.type !== 'video')) return item;
      if (!item.assetPath) return item;

      const resolvedUrl = signedUrls.get(item.assetPath) || await resolveRenderableMediaUrl(item.assetPath);
      if (resolvedUrl) {
        return { ...item, src: resolvedUrl };
      }

      const existingRenderableSrc =
        item.src && !isDataUrl(item.src) && !isBlobUrl(item.src) ? item.src : null;

      if (existingRenderableSrc) {
        return item;
      }

      return { ...item, src: null };
    })
  );

  return next;
}

function getItemPageNumber(item, pageHeight = 2200, pageGap = 40) {
  const y = Number(item?.y || 0);
  const h = Number(item?.h || 0);
  const centerY = Math.max(0, y + h / 2);
  return Math.floor(centerY / (pageHeight + pageGap)) + 1;
}

export async function hydrateLayoutMediaForPages(layout, pages = [1], { pageHeight = 2200, pageGap = 40 } = {}) {
  const next = cloneLayout(layout);
  const pageSet = new Set(
    (Array.isArray(pages) ? pages : [1])
      .map((page) => Number(page))
      .filter((page) => Number.isFinite(page) && page >= 1)
      .map((page) => Math.floor(page))
  );

  if (!pageSet.size) return next;

  const shouldHydrateItem = (item) =>
    item &&
    (item.type === 'image' || item.type === 'video') &&
    item.assetPath &&
    pageSet.has(getItemPageNumber(item, pageHeight, pageGap));

  const assetPaths = next.items.filter(shouldHydrateItem).map((item) => item.assetPath);
  const signedUrls = await createSignedUrlsForAssetPaths(assetPaths);

  next.items = await Promise.all(
    next.items.map(async (item) => {
      if (!shouldHydrateItem(item)) return item;

      const resolvedUrl = signedUrls.get(item.assetPath) || await resolveRenderableMediaUrl(item.assetPath);
      if (resolvedUrl) return { ...item, src: resolvedUrl };

      const existingRenderableSrc =
        item.src && !isDataUrl(item.src) && !isBlobUrl(item.src) ? item.src : null;

      return existingRenderableSrc ? item : { ...item, src: null };
    })
  );

  return next;
}

function guessExtFromType(type, fallback = 'bin') {
  const t = String(type || '').toLowerCase();
  if (t.includes('png')) return 'png';
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
  if (t.includes('webp')) return 'webp';
  if (t.includes('gif')) return 'gif';
  if (t.includes('mp4')) return 'mp4';
  if (t.includes('webm')) return 'webm';
  if (t.includes('quicktime')) return 'mov';
  return fallback;
}

async function dataUrlToFile(dataUrl, baseName) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const ext = guessExtFromType(blob.type, 'bin');
  return new File([blob], `${baseName}.${ext}`, {
    type: blob.type || 'application/octet-stream',
  });
}

export async function migrateLegacyInlineMedia(layout) {
  const next = cloneLayout(layout);
  let changed = false;

  next.items = await Promise.all(
    next.items.map(async (item, index) => {
      if (!item || (item.type !== 'image' && item.type !== 'video')) return item;
      if (item.assetPath) return item;
      if (!isDataUrl(item.src)) return item;

      try {
        const file = await dataUrlToFile(item.src, `${item.type}-${index + 1}`);
        const uploaded = await uploadMenuMediaFile(file, { kind: item.type });

        if (!uploaded?.assetPath) return item;

        changed = true;

        return {
          ...item,
          assetPath: uploaded.assetPath,
          src: uploaded.signedUrl || item.src,
        };
      } catch (error) {
        console.error('migrateLegacyInlineMedia failed', error);
        return item;
      }
    })
  );

  return { layout: next, changed };
}

export function clearLayoutMediaCache() {
  signedUrlCache.clear();
  pendingSignedUrlRequests.clear();

  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    objectUrlCache.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    });
  }
  objectUrlCache.clear();

  if (!canUseSessionStorage()) return;
  try {
    const keysToDelete = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith('signed:')) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => sessionStorage.removeItem(key));
  } catch {}
}
