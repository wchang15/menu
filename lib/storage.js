// lib/storage.js
// ✅ 기존에는 IndexedDB(idb-keyval)만 사용해서 기기/브라우저마다 데이터가 분리되어 있었습니다.
// ✅ 이제는 Supabase Storage를 "진짜 저장소"로 사용하고, IndexedDB는 캐시/오프라인 fallback으로만 사용합니다.
import { get, set, del, clear } from 'idb-keyval';
import { getCurrentUser } from './session';
import {
  downloadAssetBlob,
  downloadAssetBlobByPath,
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

    // ✅ 1) 로컬에 저장해둔 "버전 경로"가 있으면 그걸 우선 사용
    const localVersion = await getStoredVersion(key);

    // ✅ 2) 최신 버전 경로 조회 (Storage.list가 막혀있으면 null로 올 수 있음)
    const remoteVersion = await getLatestAssetVersion(key);
    const remotePath = remoteVersion?.version || null;

    if (remotePath && localVersion && localVersion === remotePath) return { updated: false };

    // list가 막혀도... 폴더 프리픽스(GET .../menuBackgroundBlob) 같은 400을 피하려면
    // 저장된 경로가 "파일"로 보일 때는 그걸로 직접 download를 시도
    const looksLikeFilePath = (p) =>
      typeof p === 'string' &&
      p.includes(`/${key}/`) &&
      !p.endsWith(`/${key}`) &&
      p.split('/').pop()?.includes('-');

    if (onRemoteDiff) onRemoteDiff();

    const blob = looksLikeFilePath(localVersion)
      ? await downloadAssetBlobByPath(localVersion)
      : await downloadAssetBlob(key);
    if (!blob) return { updated: false };

    const { key: scopedKey } = withUserScope(key);
    await set(scopedKey, blob);
    // remotePath가 있으면 그걸로 버전 갱신, 아니면 (list가 막혔을 때) 기존 버전 유지
    if (remotePath) await setStoredVersion(key, remotePath);
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

    const localVersion = await getStoredVersion(key);
    const remoteVersion = await getLatestAssetVersion(key);
    const remotePath = remoteVersion?.version || null;

    if (remotePath && localVersion && localVersion === remotePath) return { updated: false };

    const looksLikeFilePath = (p) =>
      typeof p === 'string' && p.includes(`/${key}/`) && !p.endsWith(`/${key}`) && p.split('/').pop()?.includes('-');

    if (onRemoteDiff) onRemoteDiff();

    let json = null;
    if (looksLikeFilePath(localVersion)) {
      const blob = await downloadAssetBlobByPath(localVersion);
      if (blob) {
        try {
          json = JSON.parse(await blob.text());
        } catch {
          json = null;
        }
      }
    } else {
      json = await downloadJsonAsset(key);
    }

    if (json === undefined || json === null) return { updated: false };

    const { key: scopedKey } = withUserScope(key);
    await set(scopedKey, json);
    if (remotePath) await setStoredVersion(key, remotePath);
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

    // ✅ 폴더 버전 방식: `${uid}/${key}/...` 전부 제거 + (있다면) legacy `${uid}/${key}` 도 제거
    const bucket = supabase.storage.from('assets');
    const prefix = `${userId}/${key}`;

    const paths = [];
    // list로 폴더 안 파일들 수집 (best-effort)
    try {
      const { data: list } = await bucket.list(prefix, { limit: 200 });
      if (Array.isArray(list)) {
        for (const it of list) {
          if (it?.name) paths.push(`${prefix}/${it.name}`);
        }
      }
    } catch {}
    paths.push(prefix); // legacy 혹은 남아있을 수 있는 단일 경로

    await bucket.remove(paths.filter(Boolean));
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

    const bucket = supabase.storage.from('assets');

    // ✅ 언어별 키까지 포함해서 전부 제거 (en/ko가 서로 덮어쓰지 않도록 키를 분리했기 때문)
    const langs = ['en', 'ko'];
    const keys = [
      KEYS.INTRO_VIDEO,
      // background + layout (language-scoped)
      ...langs.map((l) => `${KEYS.MENU_BG}_${l}`),
      ...langs.map((l) => `${KEYS.MENU_LAYOUT}_${l}`),
      ...langs.map((l) => `MENU_BG_OVERRIDES_V1_${l}`),
      // legacy (이전 버전)
      KEYS.MENU_BG,
      KEYS.MENU_LAYOUT,
      'MENU_BG_OVERRIDES_V1',
    ];

    const paths = [];
    for (const k of keys) {
      const prefix = `${userId}/${k}`;
      try {
        const { data: list } = await bucket.list(prefix, { limit: 200 });
        if (Array.isArray(list)) {
          for (const it of list) {
            if (it?.name) paths.push(`${prefix}/${it.name}`);
          }
        }
      } catch {}
      paths.push(prefix);
    }
    await bucket.remove(paths.filter(Boolean));
  } catch (e) {
    console.error('resetAll: remote remove failed', e);
  }
}