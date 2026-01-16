// lib/storage.js
// ✅ 기존에는 IndexedDB(idb-keyval)만 사용해서 기기/브라우저마다 데이터가 분리되어 있었습니다.
// ✅ 이제는 Supabase Storage를 "진짜 저장소"로 사용하고, IndexedDB는 캐시/오프라인 fallback으로만 사용합니다.
import { get, set, del, clear } from 'idb-keyval';
import { getCurrentUser } from './session';
import {
  downloadAssetBlob,
  downloadJsonAsset,
  getLatestAssetVersion,
  uploadAsset,
  uploadJsonAsset,
} from './cloudAssets';
import { supabase } from './supabaseClient';

export const KEYS = {
  INTRO_VIDEO: "introVideoBlob",
  MENU_BG: "menuBackgroundBlob",
  MENU_LAYOUT: "menuLayoutJson",
};

const VERSION_SUFFIX = '__remoteVersion';

function withUserScope(key) {
  const user = getCurrentUser();
  if (!user) return { key, user: null };
  return { key: `${user}__${key}`, user };
}

function versionKey(key) {
  return `${key}${VERSION_SUFFIX}`;
}

async function loadLocalValue(key) {
  const { key: scopedKey, user } = withUserScope(key);
  const data = await get(scopedKey);
  if (data !== undefined && data !== null) return { data, scopedKey, user };

  if (user && scopedKey !== key) {
    const fallback = await get(key);
    if (fallback !== undefined && fallback !== null) {
      await set(scopedKey, fallback);
      await del(key);
      return { data: fallback, scopedKey, user };
    }
  }

  return { data, scopedKey, user };
}

async function getStoredVersion(key) {
  const { key: scopedKey } = withUserScope(versionKey(key));
  return get(scopedKey);
}

async function setStoredVersion(key, version) {
  if (!version) return;
  const { key: scopedKey } = withUserScope(versionKey(key));
  await set(scopedKey, version);
}

export async function loadLocalBlob(key) {
  const { data } = await loadLocalValue(key);
  return data;
}

export async function loadLocalJson(key) {
  const { data } = await loadLocalValue(key);
  return data;
}

export async function saveBlob(key, blob) {
  const { key: scopedKey } = withUserScope(key);

  // 1) 로컬 캐시 저장 (즉시 반영용)
  await set(scopedKey, blob);

  // 2) 원격 저장 (Supabase). 로그인/환경 미설정이면 로컬만.
  try {
    const { data } = await supabase.auth.getSession();
    if (!data?.session) return;

    // cloudAssets.uploadAsset는 File 또는 Blob 모두 허용
    const remotePath = await uploadAsset({ assetKey: key, file: blob, contentType: blob?.type || undefined });
    await setStoredVersion(key, remotePath);
  } catch (e) {
    // 원격 저장 실패해도 로컬은 유지
    console.error('saveBlob: remote upload failed', e);
  }
}

export async function loadBlob(key) {
  const { data } = await loadLocalValue(key);
  return data;
}

export async function saveJson(key, data) {
  const { key: scopedKey } = withUserScope(key);

  // 1) 로컬 캐시 저장
  await set(scopedKey, data);

  // 2) 원격 저장
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) return;

    const remotePath = await uploadJsonAsset({ assetKey: key, data });
    await setStoredVersion(key, remotePath);
  } catch (e) {
    console.error('saveJson: remote upload failed', e);
  }
}

export async function loadJson(key) {
  const { data } = await loadLocalValue(key);
  return data;
}

export async function syncBlobFromCloud(key, { onRemoteDiff } = {}) {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) return { updated: false };

    const remoteVersion = await getLatestAssetVersion(key);
    if (!remoteVersion?.version) return { updated: false };

    const localVersion = await getStoredVersion(key);
    if (localVersion && localVersion === remoteVersion.version) {
      return { updated: false };
    }

    if (onRemoteDiff) onRemoteDiff();

    const blob = await downloadAssetBlob(key);
    if (!blob) return { updated: false };

    const { key: scopedKey } = withUserScope(key);
    await set(scopedKey, blob);
    await setStoredVersion(key, remoteVersion.version);
    return { updated: true, data: blob };
  } catch (e) {
    console.error('syncBlobFromCloud failed', e);
    return { updated: false };
  }
}

export async function syncJsonFromCloud(key, { onRemoteDiff } = {}) {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) return { updated: false };

    const remoteVersion = await getLatestAssetVersion(key);
    if (!remoteVersion?.version) return { updated: false };

    const localVersion = await getStoredVersion(key);
    if (localVersion && localVersion === remoteVersion.version) {
      return { updated: false };
    }

    if (onRemoteDiff) onRemoteDiff();

    const json = await downloadJsonAsset(key);
    if (json === undefined || json === null) return { updated: false };

    const { key: scopedKey } = withUserScope(key);
    await set(scopedKey, json);
    await setStoredVersion(key, remoteVersion.version);
    return { updated: true, data: json };
  } catch (e) {
    console.error('syncJsonFromCloud failed', e);
    return { updated: false };
  }
}

export async function removeKey(key) {
  const { key: scopedKey } = withUserScope(key);
  await del(scopedKey);
  await del(withUserScope(versionKey(key)).key);

  // 원격 삭제는 best-effort
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) return;
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return;

    await supabase.storage.from('assets').remove([`${userId}/${key}`]);
  } catch (e) {
    console.error('removeKey: remote remove failed', e);
  }
}

// ✅ 추가: 전체 초기화
export async function resetAll() {
  await clear(); // idb-keyval이 쓰는 IndexedDB 전체 삭제

  // 원격 데이터도 같이 초기화하고 싶다면(선택): 아래 키들 제거 (best-effort)
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) return;
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return;

    const keys = [KEYS.INTRO_VIDEO, KEYS.MENU_BG, KEYS.MENU_LAYOUT];
    await supabase.storage.from('assets').remove(keys.map((k) => `${userId}/${k}`));
  } catch (e) {
    console.error('resetAll: remote remove failed', e);
  }
}