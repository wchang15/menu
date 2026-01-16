// lib/storage.js
// ✅ 기존에는 IndexedDB(idb-keyval)만 사용해서 기기/브라우저마다 데이터가 분리되어 있었습니다.
// ✅ 이제는 Supabase Storage를 "진짜 저장소"로 사용하고, IndexedDB는 캐시/오프라인 fallback으로만 사용합니다.
import { get, set, del, clear } from 'idb-keyval';
import { getCurrentUser } from './session';
import { downloadAssetBlob, downloadJsonAsset, uploadAsset, uploadJsonAsset } from './cloudAssets';
import { supabase } from './supabaseClient';

export const KEYS = {
  INTRO_VIDEO: "introVideoBlob",
  MENU_BG: "menuBackgroundBlob",
  MENU_LAYOUT: "menuLayoutJson",
};

function withUserScope(key) {
  const user = getCurrentUser();
  if (!user) return { key, user: null };
  return { key: `${user}__${key}`, user };
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
    await uploadAsset({ assetKey: key, file: blob, contentType: blob?.type || undefined });
  } catch (e) {
    // 원격 저장 실패해도 로컬은 유지
    console.error('saveBlob: remote upload failed', e);
  }
}

export async function loadBlob(key) {
  const { key: scopedKey, user } = withUserScope(key);

  // 1) 원격에서 먼저 로드 (동기화의 핵심)
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session) {
      const remoteBlob = await downloadAssetBlob(key);
      if (remoteBlob) {
        await set(scopedKey, remoteBlob);
        return remoteBlob;
      }
    }
  } catch (e) {
    console.error('loadBlob: remote download failed', e);
  }

  // 2) 로컬 캐시 fallback
  const data = await get(scopedKey);
  if (data !== undefined && data !== null) return data;

  // 이전(전역) 데이터가 있다면 현재 사용자 명의로 1회만 이동
  if (user && scopedKey !== key) {
    const fallback = await get(key);
    if (fallback !== undefined && fallback !== null) {
      await set(scopedKey, fallback);
      await del(key);
      return fallback;
    }
  }

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

    await uploadJsonAsset({ assetKey: key, data });
  } catch (e) {
    console.error('saveJson: remote upload failed', e);
  }
}

export async function loadJson(key) {
  const { key: scopedKey, user } = withUserScope(key);

  // 1) 원격에서 먼저 로드
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData?.session) {
      const remoteJson = await downloadJsonAsset(key);
      if (remoteJson !== undefined && remoteJson !== null) {
        await set(scopedKey, remoteJson);
        return remoteJson;
      }
    }
  } catch (e) {
    console.error('loadJson: remote download failed', e);
  }

  // 2) 로컬 캐시 fallback
  const data = await get(scopedKey);
  if (data !== undefined && data !== null) return data;

  // 이전(전역) JSON이 있다면 현재 사용자 명의로 1회만 이동
  if (user && scopedKey !== key) {
    const fallback = await get(key);
    if (fallback !== undefined && fallback !== null) {
      await set(scopedKey, fallback);
      await del(key);
      return fallback;
    }
  }

  return data;
}

export async function removeKey(key) {
  const { key: scopedKey } = withUserScope(key);
  await del(scopedKey);

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