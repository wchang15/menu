'use client';

import { uploadAsset } from '@/lib/cloudAssets';
import { supabase } from '@/lib/supabaseClient';

const BUCKET = 'assets';
const SIGNED_URL_TTL = 60 * 60 * 24 * 7;

const signedUrlCache = new Map();
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

function getSessionSignedUrl(assetPath) {
  if (!assetPath || !canUseSessionStorage()) return null;
  try {
    return sessionStorage.getItem(`signed:${assetPath}`) || null;
  } catch {
    return null;
  }
}

function setSessionSignedUrl(assetPath, url) {
  if (!assetPath || !url || !canUseSessionStorage()) return;
  try {
    sessionStorage.setItem(`signed:${assetPath}`, url);
  } catch {}
}

export function sanitizeLayoutMedia(layout) {
  const next = cloneLayout(layout);

  next.items = next.items.map((item) => {
    if (!item || (item.type !== 'image' && item.type !== 'video')) return item;

    const cloned = { ...item };

    if (cloned.assetPath) {
      if (isDataUrl(cloned.src) || isBlobUrl(cloned.src)) delete cloned.src;
      if (cloned.localSrc && (isDataUrl(cloned.localSrc) || isBlobUrl(cloned.localSrc))) {
        delete cloned.localSrc;
      }
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

export async function uploadMenuMediaFile(file, { kind = 'media' } = {}) {
  if (!file) return null;

  const assetPath = await uploadAsset({
    assetKey: `menu_media_${kind}`,
    file,
    contentType: file?.type || undefined,
  });

  const signedUrl = await createSignedUrlForAssetPath(assetPath);
  return { assetPath, signedUrl };
}

export async function hydrateLayoutMedia(layout) {
  const next = cloneLayout(layout);

  next.items = await Promise.all(
    next.items.map(async (item) => {
      if (!item || (item.type !== 'image' && item.type !== 'video')) return item;
      if (!item.assetPath) return item;

      if (item.src && !isDataUrl(item.src) && !isBlobUrl(item.src)) {
        signedUrlCache.set(item.assetPath, item.src);
        setSessionSignedUrl(item.assetPath, item.src);
        return item;
      }

      const signedUrl = await createSignedUrlForAssetPath(item.assetPath);
      if (!signedUrl) return item;

      return { ...item, src: signedUrl };
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