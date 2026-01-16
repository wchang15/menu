'use client';

import { supabase } from '@/lib/supabaseClient';

const USE_SERVER_SIGNING = false;

async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

async function getUserId() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id || null;
}

async function requestSignedUpload({ token, assetKey, filename, contentType, sizeBytes }) {
  const response = await fetch('/api/assets/presign', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      assetKey,
      filename,
      contentType,
      sizeBytes,
    }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => null);
    throw new Error(errBody?.error || '업로드 URL 생성에 실패했습니다.');
  }

  return response.json();
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
    const errBody = await response.json().catch(() => null);
    throw new Error(errBody?.error || '다운로드 URL 생성에 실패했습니다.');
  }

  return response.json();
}

// ✅ Prefer streaming URLs for large assets (video) to avoid downloading full blobs.
// Returns a signed URL (or null). In `next export` builds, it falls back to Storage client.
export async function getSignedAssetUrl(assetKey, { expiresInSec = 60 * 30 } = {}) {
  if (!assetKey) return null;

  // 1) Try server-signed URL (works in dev; API routes exist)
  const token = USE_SERVER_SIGNING ? await getAccessToken() : null;
  if (USE_SERVER_SIGNING && token) {
    try {
      const signed = await requestSignedDownload({ token, assetKey });
      if (signed?.signedUrl) return signed.signedUrl;
    } catch {
      // ignore → fall back
    }
  }

  // 2) Fallback: create a signed URL directly from Storage (works in exported builds)
  const userId = await getUserId();
  if (!userId) return null;

  // Prefer newest version under `${uid}/${assetKey}/...`
  const folder = `${userId}/${assetKey}`;
  try {
    const { data: list, error: listError } = await supabase.storage
      .from('assets')
      .list(folder, { limit: 50 });

    if (!listError && Array.isArray(list) && list.length > 0) {
      const latest = [...list]
        .filter((x) => x?.name)
        .sort((a, b) => (a.name < b.name ? 1 : -1))[0];

      if (latest?.name) {
        const path = `${folder}/${latest.name}`;
        const { data, error } = await supabase.storage
          .from('assets')
          .createSignedUrl(path, expiresInSec);
        if (!error && data?.signedUrl) return data.signedUrl;
      }
    }
  } catch {
    // ignore
  }

  // Legacy single path
  const legacyPath = `${userId}/${assetKey}`;
  const { data, error } = await supabase.storage
    .from('assets')
    .createSignedUrl(legacyPath, expiresInSec);
  if (error) return null;
  return data?.signedUrl || null;
}

export async function uploadAsset({ assetKey, file, contentType }) {
  if (!assetKey || !file) return null;

  const token = USE_SERVER_SIGNING ? await getAccessToken() : null;
  if (USE_SERVER_SIGNING && !token) {
    throw new Error('로그인이 필요합니다. 다시 로그인해 주세요.');
  }

  // file can be a File or a Blob. Normalize metadata.
  const inferredContentType =
    contentType || (typeof file.type === 'string' && file.type) || 'application/octet-stream';
  const inferredFilename =
    typeof file.name === 'string' && file.name.trim().length > 0 ? file.name : `${assetKey}`;
  const inferredSizeBytes = typeof file.size === 'number' ? file.size : null;

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
        headers: {
          'Content-Type': inferredContentType,
        },
        body: file,
      });

      if (!uploadResponse.ok) {
        throw new Error('파일 업로드에 실패했습니다.');
      }

      return presign.path;
    }
  } catch (error) {
    const userId = await getUserId();
    if (!userId) throw error;

    const safeName =
      typeof file.name === 'string' && file.name.trim().length > 0 ? file.name.trim() : `${assetKey}.bin`;
    // ✅ 버전 경로: 캐시/덮어쓰기 문제 방지
    const objectPath = `${userId}/${assetKey}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from('assets').upload(objectPath, file, {
      contentType: inferredContentType,
      upsert: false, // ✅ 덮어쓰기 금지 (캐시 이슈 방지)
      cacheControl: '0', // ✅ 캐시 최소화
    });
    if (uploadError) {
      throw uploadError;
    }

    return objectPath;
  }

  const userId = await getUserId();
  if (!userId) {
    throw new Error('로그인이 필요합니다. 다시 로그인해 주세요.');
  }

  const safeName =
    typeof file.name === 'string' && file.name.trim().length > 0 ? file.name.trim() : `${assetKey}.bin`;
  const objectPath = `${userId}/${assetKey}/${Date.now()}-${safeName}`;
  const { error: uploadError } = await supabase.storage.from('assets').upload(objectPath, file, {
    contentType: inferredContentType,
    upsert: false,
    cacheControl: '0',
  });
  if (uploadError) {
    throw uploadError;
  }

  return objectPath;
}

export async function uploadJsonAsset({ assetKey, data }) {
  if (!assetKey) return null;
  const file = new File([JSON.stringify(data ?? {})], `${assetKey}.json`, {
    type: 'application/json',
  });
  return uploadAsset({ assetKey, file, contentType: 'application/json' });
}

export async function downloadAssetBlob(assetKey) {
  if (!assetKey) return null;
  const token = USE_SERVER_SIGNING ? await getAccessToken() : null;
  if (USE_SERVER_SIGNING && !token) return null;

  if (USE_SERVER_SIGNING) {
    try {
      const signed = await requestSignedDownload({ token, assetKey });
      if (!signed?.signedUrl) return null;

      const response = await fetch(signed.signedUrl);
      if (!response.ok) return null;

      return response.blob();
    } catch (error) {
      console.error('Failed to sign download URL', error);
    }
  }

  const userId = await getUserId();
  if (!userId) return null;

  // ✅ 새 방식: 폴더(버전)에서 최신 파일을 먼저 시도
  const folder = `${userId}/${assetKey}`;
  try {
    const { data: list, error: listError } = await supabase.storage
      .from('assets')
      .list(folder, { limit: 50 });

    if (!listError && Array.isArray(list) && list.length > 0) {
      const latest = [...list]
        .filter((x) => x?.name)
        .sort((a, b) => (a.name < b.name ? 1 : -1))[0];

      if (latest?.name) {
        const latestPath = `${folder}/${latest.name}`;
        const { data, error } = await supabase.storage.from('assets').download(latestPath);
        if (!error && data) return data;
      }
    }
  } catch (e) {
    console.error('Failed to list/download versioned assets', e);
  }

  // 레거시(이전 방식): 단일 경로
  const legacyPath = `${userId}/${assetKey}`;
  const { data, error } = await supabase.storage.from('assets').download(legacyPath);
  if (error) {
    console.error('Failed to download asset via storage client', error);
    return null;
  }
  return data || null;
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

export async function getLatestAssetVersion(assetKey) {
  if (!assetKey) return null;

  const userId = await getUserId();
  if (!userId) return null;

  const folder = `${userId}/${assetKey}`;
  try {
    const { data: list, error: listError } = await supabase.storage
      .from('assets')
      .list(folder, { limit: 50 });

    if (!listError && Array.isArray(list) && list.length > 0) {
      const latest = [...list]
        .filter((x) => x?.name)
        .sort((a, b) => (a.name < b.name ? 1 : -1))[0];

      if (latest?.name) {
        const path = `${folder}/${latest.name}`;
        return { version: path, path };
      }
    }
  } catch {
    // ignore
  }

  const legacyPath = `${userId}/${assetKey}`;
  let version = legacyPath;
  try {
    const { data, error } = await supabase.storage.from('assets').createSignedUrl(legacyPath, 60);
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
