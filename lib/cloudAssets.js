'use client';

import { supabase } from '@/lib/supabaseClient';

/**
 * ✅ APK(정적 export + WebView)에서는 Next API route(/api/...)가 없어서
 * /api/assets/* 호출하면 HTML(404)이 돌아오고 JSON 파싱이 터짐.
 * 따라서 WebView/localhost 계열에서는 서버 사인 기능을 무조건 꺼버린다.
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
// Storage helpers
// -------------------------
function normalizeName(name) {
  if (!name) return '';
  return String(name).replace(/\\/g, '/').replace(/^\/+/, '');
}

async function listLatestVersionPath({ userId, assetKey }) {
  const folder = `${userId}/${assetKey}`;
  try {
    const { data: list, error } = await supabase.storage.from(BUCKET).list(folder, { limit: 200 });
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

/**
 * ✅ (옵션) legacy 단일 경로 업서트
 * - 폴더 방식으로 저장해도 `${uid}/${assetKey}` 단일 파일도 같이 만들어두면
 *   과거 코드/다른 경로에서 legacy로 접근해도 안 터짐.
 * - 단, 너가 "완전 깔끔" 원하면 이걸 끄면 됨.
 */
// ✅ 폴더(버전) 방식만 쓸 거면 legacy는 끄는 게 맞음.
// legacy를 켜두면 `${uid}/${assetKey}` 단일 경로에도 파일을 한 번 더 올려서
// 과거 코드가 살아있어도 깨지지 않게 해주지만, 비용/복잡도가 올라감.
const ENABLE_LEGACY_MIRROR = false;

// ✅ legacy(단일 경로) 다운로드/사인 URL fallback을 완전히 끄고 싶으면 true
// 폴더 구조를 쓰는 상태에서 legacy fallback을 켜두면,
// `${uid}/${assetKey}` (폴더 프리픽스) 를 파일처럼 GET 하면서
// 콘솔에 400(Bad Request) 로그가 남는 경우가 있음.
const DISABLE_LEGACY_FALLBACK = true;

async function upsertLegacyAsset({ userId, assetKey, fileOrBlob, contentType }) {
  if (!ENABLE_LEGACY_MIRROR) return;
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

  // 2) Storage client signed URL
  const userId = await getUserId();
  if (!userId) return null;

  // ✅ 2-1) 폴더 최신 버전 우선
  const latestPath = await listLatestVersionPath({ userId, assetKey });
  if (latestPath) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(latestPath, expiresInSec);
    if (!error && data?.signedUrl) return data.signedUrl;
  }

  // ✅ 2-2) legacy fallback (옵션)
  if (!DISABLE_LEGACY_FALLBACK) {
    const legacyPath = `${userId}/${assetKey}`;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(legacyPath, expiresInSec);
    if (!error && data?.signedUrl) return data.signedUrl;
  }

  return null;
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
    typeof file.name === 'string' && file.name.trim().length > 0 ? file.name.trim() : `${assetKey}.bin`;

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
  } catch {
    // fall through
  }

  // ✅ direct upload (versioned folder)
  const userId = await getUserId();
  if (!userId) throw new Error('로그인이 필요합니다. 다시 로그인해 주세요.');

  const objectPath = `${userId}/${assetKey}/${Date.now()}-${inferredFilename}`;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(objectPath, file, {
    contentType: inferredContentType,
    upsert: false,
    cacheControl: '0',
  });
  if (uploadError) throw uploadError;

  // ✅ optional legacy mirror
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
// Download (blob/json)
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
    }
  }

  // 2) storage client
  const userId = await getUserId();
  if (!userId) return null;

  // ✅ 2-1) 폴더 최신 버전 우선
  const latestPath = await listLatestVersionPath({ userId, assetKey });
  if (latestPath) {
    try {
      const { data, error } = await supabase.storage.from(BUCKET).download(latestPath);
      if (!error && data) {
        // optional legacy mirror
        await upsertLegacyAsset({ userId, assetKey, fileOrBlob: data, contentType: data?.type });
        return data;
      }
    } catch (e) {
      console.error('Failed to download latest version asset', e);
    }
  }

  // ✅ 2-2) legacy fallback (옵션)
  if (!DISABLE_LEGACY_FALLBACK) {
    const legacyPath = `${userId}/${assetKey}`;
    try {
      const { data, error } = await supabase.storage.from(BUCKET).download(legacyPath);
      if (!error && data) return data;
    } catch (e) {
      console.error('Failed to download legacy asset', e);
    }
  }

  return null;
}

// ✅ 특정 "파일 경로"를 바로 다운로드 (버전 경로를 저장해두고 재사용할 때 유용)
export async function downloadAssetBlobByPath(objectPath) {
  if (!objectPath) return null;
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(objectPath);
    if (!error && data) return data;
  } catch {
    // ignore
  }
  return null;
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

  // legacy fallback (옵션)
  if (!DISABLE_LEGACY_FALLBACK) {
    const legacyPath = `${userId}/${assetKey}`;
    return { version: legacyPath, path: legacyPath, legacy: true };
  }

  return null;
}