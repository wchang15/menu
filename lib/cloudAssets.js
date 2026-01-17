'use client';

import { supabase } from '@/lib/supabaseClient';

/**
 * ✅ APK(정적 export + WebView)에서는 Next API route(/api/...)가 없어서
 * /api/assets/* 호출하면 HTML(404)이 돌아오고 JSON 파싱이 터짐.
 * 따라서 WebView/localhost 계열에서는 서버 사인 기능을 무조건 꺼버린다.
 *
 * Capacitor는 보통:
 * - capacitor://localhost
 * - https://localhost
 * - http://localhost
 * 형태가 많음.
 */
const IS_LOCALHOST_APP =
  typeof window !== 'undefined' &&
  (() => {
    const host = window.location?.host || '';
    const hostname = window.location?.hostname || '';
    const protocol = window.location?.protocol || '';
    return (
      hostname === 'localhost' ||
      host.startsWith('localhost') ||
      protocol === 'capacitor:' ||
      protocol === 'file:'
    );
  })();

// ⚠️ 서버 사인 기능을 쓰려면 아래 false를 true로 바꿔라.
// 단, localhost(WebView)에서는 자동으로 꺼짐.
const USE_SERVER_SIGNING = !IS_LOCALHOST_APP && false;

const BUCKET = 'assets';

// -------------------------
// Session helpers
// -------------------------
async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

async function getUserId() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id || null;
}

// -------------------------
// Robust fetch helpers (avoid JSON parse crash on HTML)
// -------------------------
async function safeReadJson(response) {
  const text = await response.text().catch(() => '');
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

async function requestSignedUpload({ token, assetKey, filename, contentType, sizeBytes }) {
  const response = await fetch('/api/assets/presign', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ assetKey, filename, contentType, sizeBytes }),
  });

  if (!response.ok) {
    const errBody = await safeReadJson(response);
    throw new Error(errBody?.error || errBody?._raw || '업로드 URL 생성에 실패했습니다.');
  }

  return safeReadJson(response);
}

async function requestSignedDownload({ token, assetKey }) {
  const response = await fetch('/api/assets/sign-download', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ assetKey }),
  });

  if (!response.ok) {
    const errBody = await safeReadJson(response);
    throw new Error(errBody?.error || errBody?._raw || '다운로드 URL 생성에 실패했습니다.');
  }

  return safeReadJson(response);
}

// -------------------------
// Legacy upsert (auto-migrate old data)
// -------------------------
async function upsertLegacyAsset({ userId, assetKey, fileOrBlob, contentType }) {
  if (!userId || !assetKey || !fileOrBlob) return;

  const inferredContentType =
    contentType ||
    (typeof fileOrBlob?.type === 'string' && fileOrBlob.type) ||
    'application/octet-stream';

  const legacyPath = `${userId}/${assetKey}`;

  await supabase.storage
    .from(BUCKET)
    .upload(legacyPath, fileOrBlob, {
      contentType: inferredContentType,
      upsert: true,
      cacheControl: '0',
    })
    .catch(() => {});
}

function normalizeName(name) {
  if (!name) return '';
  return String(name).replace(/\\/g, '/').replace(/^\/+/, '');
}

async function listLatestVersionPath({ userId, assetKey }) {
  const folder = `${userId}/${assetKey}`;
  try {
    const { data: list, error } = await supabase.storage.from(BUCKET).list(folder, { limit: 100 });
    if (error || !Array.isArray(list) || list.length === 0) return null;

    const latest = [...list]
      .filter((x) => x?.name)
      .sort((a, b) => (a.name < b.name ? 1 : -1))[0];

    if (!latest?.name) return null;
    return `${folder}/${normalizeName(latest.name)}`;
  } catch {
    return null;
  }
}

// -------------------------
// Signed URL for streaming (video)
// -------------------------
export async function getSignedAssetUrl(assetKey, { expiresInSec = 60 * 30 } = {}) {
  if (!assetKey) return null;

  // 1) Try server-signed URL (only when enabled + not localhost)
  const token = USE_SERVER_SIGNING ? await getAccessToken() : null;
  if (USE_SERVER_SIGNING && token) {
    try {
      const signed = await requestSignedDownload({ token, assetKey });
      if (signed?.signedUrl) return signed.signedUrl;
    } catch {
      // ignore -> fallback
    }
  }

  // 2) Storage client signed URL (export build safe)
  const userId = await getUserId();
  if (!userId) return null;

  // ✅ Prefer newest version under `${uid}/${assetKey}/...`
  const latestPath = await listLatestVersionPath({ userId, assetKey });
  if (latestPath) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(latestPath, expiresInSec);
    if (!error && data?.signedUrl) return data.signedUrl;
  }

  // ✅ Legacy single path (might not exist yet; returns null if not)
  const legacyPath = `${userId}/${assetKey}`;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(legacyPath, expiresInSec);
  if (error) return null;
  return data?.signedUrl || null;
}

// -------------------------
// Upload
// -------------------------
export async function uploadAsset({ assetKey, file, contentType }) {
  if (!assetKey || !file) return null;

  const token = USE_SERVER_SIGNING ? await getAccessToken() : null;
  if (USE_SERVER_SIGNING && !token) throw new Error('로그인이 필요합니다. 다시 로그인해 주세요.');

  const inferredContentType =
    contentType || (typeof file.type === 'string' && file.type) || 'application/octet-stream';
  const inferredFilename =
    typeof file.name === 'string' && file.name.trim().length > 0 ? file.name : `${assetKey}`;
  const inferredSizeBytes = typeof file.size === 'number' ? file.size : null;

  // ✅ server signing path (dev only)
  try {
    if (USE_SERVER_SIGNING) {
      const presign = await requestSignedUpload({
        token,
        assetKey,
        filename: inferredFilename,
        contentType: inferredContentType,
        sizeBytes: inferredSizeBytes,
      });

      const uploadResponse = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': inferredContentType },
        body: file,
      });

      if (!uploadResponse.ok) throw new Error('파일 업로드에 실패했습니다.');
      return presign.path;
    }
  } catch (e) {
    // fall through to direct upload
  }

  // ✅ direct upload
  const userId = await getUserId();
  if (!userId) throw new Error('로그인이 필요합니다. 다시 로그인해 주세요.');

  const safeName =
    typeof file.name === 'string' && file.name.trim().length > 0 ? file.name.trim() : `${assetKey}.bin`;

  // versioned path
  const objectPath = `${userId}/${assetKey}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(objectPath, file, {
    contentType: inferredContentType,
    upsert: false,
    cacheControl: '0',
  });
  if (uploadError) throw uploadError;

  // ✅✅ legacyPath upsert (so future legacy signed/download never 400)
  await upsertLegacyAsset({ userId, assetKey, fileOrBlob: file, contentType: inferredContentType });

  return objectPath;
}

export async function uploadJsonAsset({ assetKey, data }) {
  if (!assetKey) return null;
  const file = new File([JSON.stringify(data ?? {})], `${assetKey}.json`, {
    type: 'application/json',
  });
  return uploadAsset({ assetKey, file, contentType: 'application/json' });
}

// -------------------------
// Download (blob/json) + AUTO MIGRATION to legacy
// -------------------------
export async function downloadAssetBlob(assetKey) {
  if (!assetKey) return null;

  // 1) server signing (dev only)
  const token = USE_SERVER_SIGNING ? await getAccessToken() : null;
  if (USE_SERVER_SIGNING && !token) return null;

  if (USE_SERVER_SIGNING) {
    try {
      const signed = await requestSignedDownload({ token, assetKey });
      if (signed?.signedUrl) {
        const res = await fetch(signed.signedUrl);
        if (res.ok) return await res.blob();
      }
    } catch (error) {
      console.error('Failed to sign download URL', error);
      // fall through
    }
  }

  // 2) storage client
  const userId = await getUserId();
  if (!userId) return null;

  // ✅ try latest version first
  const latestPath = await listLatestVersionPath({ userId, assetKey });
  if (latestPath) {
    try {
      const { data, error } = await supabase.storage.from(BUCKET).download(latestPath);
      if (!error && data) {
        // ✅✅ auto-migrate: ensure legacy exists so other code paths won't 400 later
        await upsertLegacyAsset({
          userId,
          assetKey,
          fileOrBlob: data,
          contentType: data?.type,
        });
        return data;
      }
    } catch (e) {
      console.error('Failed to download latest version asset', e);
    }
  }

  // ✅ legacy fallback
  const legacyPath = `${userId}/${assetKey}`;
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(legacyPath);
    if (error) {
      console.error('Failed to download asset via storage client', error);
      return null;
    }
    return data || null;
  } catch (e) {
    console.error('Failed to download legacy asset', e);
    return null;
  }
}

export async function downloadJsonAsset(assetKey) {
  const blob = await downloadAssetBlob(assetKey);
  if (!blob) return null;

  try {
    const text = await blob.text();
    return JSON.parse(text);
  } catch (error) {
    console.error('Failed to parse JSON asset', error);
    return null;
  }
}

// -------------------------
// Version helper
// -------------------------
export async function getLatestAssetVersion(assetKey) {
  if (!assetKey) return null;

  const userId = await getUserId();
  if (!userId) return null;

  const latestPath = await listLatestVersionPath({ userId, assetKey });
  if (latestPath) return { version: latestPath, path: latestPath };

  // legacy path fallback
  const legacyPath = `${userId}/${assetKey}`;
  let version = legacyPath;

  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(legacyPath, 60);
    if (!error && data?.signedUrl) {
      const head = await fetch(data.signedUrl, { method: 'HEAD' });
      if (head.ok) {
        const etag = head.headers.get('etag') || head.headers.get('ETag');
        const lastModified = head.headers.get('last-modified');
        const meta = [etag, lastModified].filter(Boolean).join('|');
        if (meta) version = `${legacyPath}|${meta}`;
      }
    }
  } catch {
    // ignore
  }

  return { version, path: legacyPath, legacy: true };
}