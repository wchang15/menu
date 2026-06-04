'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KEYS, loadLocalBlob, loadLocalJson, saveBlob, saveJson, syncBlobFromCloud, syncJsonFromCloud } from '@/lib/storage';
import { getSignedAssetUrl } from '@/lib/cloudAssets';
import { clearCurrentUser, setCurrentUser } from '@/lib/session';
import { supabase } from '@/lib/supabaseClient';
import * as layoutMedia from '@/lib/layoutMedia';
import { readMenuReadyBundle, readMenuReadyBundleAsync, writeMenuReadyBundleAsync } from '@/lib/menuReadyBundle';

const LANG_KEY = 'APP_LANG_V1';
const INTRO_ASSET_KEY = KEYS.INTRO_VIDEO;
const menuLayoutKey = (language) => `${KEYS.MENU_LAYOUT}_${language || 'en'}`;
const menuBgKey = (language) => `${KEYS.MENU_BG}_${language || 'en'}`;
const bgOverridesKey = (language) => `MENU_BG_OVERRIDES_V1_${language || 'en'}`;
const bgPageKey = (page, language) => `${menuBgKey(language)}__P${page}`;
const fallbackLanguageFor = (language) => (language === 'ko' ? 'en' : 'ko');
const MENU_IMAGE_PRELOAD_TIMEOUT_MS = 10000;
const MENU_IMAGE_PRELOAD_ATTEMPTS = 2;
const MENU_IMAGE_PRELOAD_CONCURRENCY = 16;
const MENU_WARMUP_MAX_WAIT_MS = 45000;
const pendingMenuWarmups = new Map();
const WINDOW_READY_VIEW_STORE = '__MENU_READY_VIEW_STORE_V1__';
const blobObjectUrlCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
const BLACK_POSTER = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="100%" height="100%" fill="black"/></svg>'
)}`;

const isBlobLike = (value) =>
  value && typeof Blob !== 'undefined' && (value instanceof Blob || value instanceof File);

function getReusableBlobObjectUrl(blob) {
  if (!isBlobLike(blob) || typeof URL === 'undefined') return null;
  if (!blobObjectUrlCache) return URL.createObjectURL(blob);
  const cached = blobObjectUrlCache.get(blob);
  if (cached) return cached;
  const nextUrl = URL.createObjectURL(blob);
  blobObjectUrlCache.set(blob, nextUrl);
  return nextUrl;
}

function getLayoutImageUrls(layout) {
  const items = Array.isArray(layout?.items) ? layout.items : [];
  const templateData = layout?.templateData && typeof layout.templateData === 'object'
    ? layout.templateData
    : {};
  const templateUrls = [
    templateData.logoSrc,
    templateData.qrSrc,
    templateData.photoSrc,
    ...(Array.isArray(templateData.photos) ? templateData.photos : []),
  ];

  return Array.from(new Set([
    ...items
      .filter((item) => item && item.type === 'image' && typeof item.src === 'string' && item.src)
      .map((item) => item.src),
    ...templateUrls,
  ].filter(Boolean)));
}

function imagePreloadStatsComplete(layout, stats) {
  const imageCount = getLayoutImageUrls(layout).length;
  if (!imageCount) return true;

  const total = Number(stats?.total || 0);
  const loaded = Number(stats?.loaded || 0);
  const failed = Number(stats?.failed || 0);
  return total >= imageCount && loaded >= total && failed === 0;
}

function hasBundleBackground(bundle) {
  return !!bundle?.bgBlob ||
    !!bundle?.bgSignedUrl ||
    Object.keys(bundle?.bgOverrides || {}).length > 0 ||
    Object.keys(bundle?.bgOverrideSignedUrls || {}).length > 0;
}

function menuBundleVisuallyReady(bundle) {
  if (!bundle?.layout || typeof bundle.layout !== 'object') return false;
  if (!layoutMediaRenderable(bundle.layout)) return false;
  if (!imagePreloadStatsComplete(bundle.layout, bundle.imagePreloadStats)) return false;
  if (bundle.layout.mode === 'custom' && !hasBundleBackground(bundle)) return false;
  return bundle.layout.mode === 'custom' || bundle.layout.mode === 'template';
}

function isUsableMenuLayout(layout) {
  return layout?.mode === 'custom' || layout?.mode === 'template';
}

function hasWindowReadyMenu(language, userId) {
  if (typeof window === 'undefined') return false;
  try {
    const store = window[WINDOW_READY_VIEW_STORE];
    const safeLang = language === 'ko' ? 'ko' : 'en';
    const exact = store?.get?.(`${userId || 'user'}:${safeLang}`);
    if (exact?.userId && exact.userId !== userId) return false;
    if (!(exact?.layout?.mode === 'custom' || exact?.layout?.mode === 'template')) return false;
    if (!layoutMediaRenderable(exact.layout)) return false;
    if (exact.layout.mode === 'custom' && !hasBundleBackground(exact)) return false;
    return true;
  } catch {
    return false;
  }
}

function writeWindowReadyMenu({
  language,
  userId,
  layout,
  bgBlob = null,
  bgOverrides = {},
  bgObjectUrl = null,
  bgOverrideObjectUrls = {},
  bgSignedUrl = null,
  bgOverrideSignedUrls = {},
}) {
  if (typeof window === 'undefined') return;
  if (!(layout?.mode === 'custom' || layout?.mode === 'template')) return;
  if (!layoutMediaRenderable(layout)) return;
  if (layout.mode === 'custom' && !hasBundleBackground({ bgBlob, bgOverrides, bgSignedUrl, bgOverrideSignedUrls })) return;

  try {
    if (!window[WINDOW_READY_VIEW_STORE]) {
      window[WINDOW_READY_VIEW_STORE] = new Map();
    }
    const safeLang = language === 'ko' ? 'ko' : 'en';
    window[WINDOW_READY_VIEW_STORE].set(`${userId || 'user'}:${safeLang}`, {
      language: safeLang,
      userId: userId || null,
      layout,
      bgBlob: bgBlob || null,
      bgOverrides: bgOverrides || {},
      bgObjectUrl: bgObjectUrl || getReusableBlobObjectUrl(bgBlob) || null,
      bgOverrideObjectUrls: bgOverrideObjectUrls || {},
      bgSignedUrl: bgSignedUrl || null,
      bgOverrideSignedUrls: bgOverrideSignedUrls || {},
      ts: Date.now(),
    });
  } catch {
    // ignore menu handoff cache failures
  }
}

function isBlobUrlSrc(value) {
  return typeof value === 'string' && value.startsWith('blob:');
}

function isMediaItem(item) {
  return item && (item.type === 'image' || item.type === 'video');
}

function layoutMediaRenderable(layout) {
  const items = Array.isArray(layout?.items) ? layout.items : [];
  return !items.some((item) => {
    if (!item || item.type !== 'image') return false;
    const src = typeof item.src === 'string' ? item.src : '';
    return (item.assetPath && (!src || isBlobUrlSrc(src))) || (!item.assetPath && isBlobUrlSrc(src));
  });
}

function mediaItemNeedsRepair(item) {
  if (!isMediaItem(item)) return false;
  if (item.assetPath && (!item.src || isBlobUrlSrc(item.src))) return true;
  return !item.assetPath && (!item.src || isBlobUrlSrc(item.src));
}

function repairMissingMediaItemsFromFallback(targetLayout, fallbackLayout) {
  const targetItems = Array.isArray(targetLayout?.items) ? targetLayout.items : [];
  const fallbackMediaItems = (Array.isArray(fallbackLayout?.items) ? fallbackLayout.items : [])
    .filter((item) => isMediaItem(item) && (item.assetPath || (item.src && !isBlobUrlSrc(item.src))));

  if (!targetItems.length || !fallbackMediaItems.length) {
    return { layout: targetLayout, changed: false };
  }

  let mediaIndex = 0;
  let changed = false;

  const repairedItems = targetItems.map((item) => {
    if (!isMediaItem(item)) return item;

    const fallbackItem = fallbackMediaItems[mediaIndex];
    mediaIndex += 1;

    if (!mediaItemNeedsRepair(item) || !fallbackItem) return item;

    const fallbackSrc = fallbackItem.src && !isBlobUrlSrc(fallbackItem.src) ? fallbackItem.src : null;
    const nextAssetPath = item.assetPath || fallbackItem.assetPath || null;
    const nextSrc = fallbackSrc || (item.src && !isBlobUrlSrc(item.src) ? item.src : null);

    if (!nextAssetPath && !nextSrc) return item;

    changed = true;
    return {
      ...item,
      ...(nextAssetPath ? { assetPath: nextAssetPath } : {}),
      src: nextSrc,
    };
  });

  return {
    layout: { ...targetLayout, items: repairedItems },
    changed,
  };
}

function preloadImageUrl(url, timeoutMs = MENU_IMAGE_PRELOAD_TIMEOUT_MS) {
  if (!url || typeof Image === 'undefined' || typeof window === 'undefined') {
    return Promise.resolve({ url, loaded: false });
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = (loaded) => {
      if (done) return;
      done = true;
      resolve({ url, loaded: !!loaded });
    };
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    const img = new Image();
    img.onload = () => {
      window.clearTimeout(timer);
      finish(true);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      finish(false);
    };
    img.src = url;
  });
}

function withTimeout(promise, timeoutMs, fallback = null) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve(fallback), timeoutMs);
    }),
  ]);
}

async function preloadImageUrls(urls, timeoutMs = MENU_IMAGE_PRELOAD_TIMEOUT_MS) {
  const uniqueUrls = Array.from(new Set((urls || []).filter(Boolean)));
  if (!uniqueUrls.length || typeof window === 'undefined') {
    return { total: 0, loaded: 0, failed: 0 };
  }

  const results = [];
  let nextIndex = 0;
  const workerCount = Math.min(MENU_IMAGE_PRELOAD_CONCURRENCY, uniqueUrls.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < uniqueUrls.length) {
      const url = uniqueUrls[nextIndex];
      nextIndex += 1;
      results.push(await preloadImageUrl(url, timeoutMs));
    }
  }));

  const loaded = results.filter((result) => result.loaded).length;
  const failedUrls = results.filter((result) => !result.loaded).map((result) => result.url).filter(Boolean);
  return {
    total: uniqueUrls.length,
    loaded,
    failed: failedUrls.length,
    failedUrls,
  };
}

async function preloadImageUrlsUntilReady(urls, timeoutMs = MENU_IMAGE_PRELOAD_TIMEOUT_MS) {
  let remaining = Array.from(new Set((urls || []).filter(Boolean)));
  let totalLoaded = 0;
  let lastStats = { total: remaining.length, loaded: 0, failed: remaining.length, failedUrls: remaining };

  for (let attempt = 0; attempt < MENU_IMAGE_PRELOAD_ATTEMPTS && remaining.length; attempt += 1) {
    lastStats = await preloadImageUrls(remaining, timeoutMs);
    totalLoaded += lastStats.loaded;
    remaining = lastStats.failedUrls || [];
  }

  return {
    total: Array.from(new Set((urls || []).filter(Boolean))).length,
    loaded: totalLoaded,
    failed: remaining.length,
    failedUrls: remaining,
  };
}

export default function IntroPlayer() {
  const router = useRouter();
  const videoRef = useRef(null);
  const introUploadInputRef = useRef(null);

  const [videoBlob, setVideoBlob] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [videoVisible, setVideoVisible] = useState(false);
  const [muted, setMuted] = useState(true);
  const [loading, setLoading] = useState(true);
  const [introResolved, setIntroResolved] = useState(false);
  const [introUploading, setIntroUploading] = useState(false);
  const [introUploadMessage, setIntroUploadMessage] = useState('');
  const [introDragOver, setIntroDragOver] = useState(false);
  const [menuLoading, setMenuLoading] = useState(false);
  const [userReady, setUserReady] = useState(false);
  const [userId, setUserId] = useState(null);
  const [lang, setLang] = useState('en');

  const T = {
    soundOn: lang === 'ko' ? '소리 켜기' : 'Sound On',
    soundOff: lang === 'ko' ? '소리 끄기' : 'Sound Off',
    goMenu: lang === 'ko' ? '메뉴로' : 'Go to Menu',
    loadingMenu: lang === 'ko' ? '메뉴 로딩 중...' : 'Loading Menu...',
    uploadIntroTitle: lang === 'ko' ? '인트로 비디오를 업로드하세요' : 'Upload an intro video',
    uploadIntroDesc: lang === 'ko'
      ? '매장 첫 화면에 나올 영상을 추가해 주세요. 업로드하면 바로 미리보기로 재생되고, 메뉴 설정으로 넘어갈 수 있습니다.'
      : 'Add the video guests will see first. After upload, it plays here immediately and you can continue to menu setup.',
    uploadIntroButton: lang === 'ko' ? '인트로 비디오 업로드' : 'Upload intro video',
    uploadIntroDrop: lang === 'ko' ? 'MP4, MOV 권장 · 탭해서 선택하거나 파일을 놓으세요' : 'MP4 or MOV recommended · tap to choose or drop a file',
    introUploading: lang === 'ko' ? '영상 업로드 중...' : 'Uploading video...',
    introUploadDone: lang === 'ko' ? '영상이 업로드되었습니다. 미리보기를 확인해 주세요.' : 'Video uploaded. Preview it here before continuing.',
    introUploadFail: lang === 'ko' ? '영상 업로드 중 문제가 발생했습니다.' : 'Video upload failed.',
    skipToMenuSetup: lang === 'ko' ? '메뉴 설정으로 이동' : 'Continue to menu setup',
  };

  useEffect(() => {
    let alive = true;
    let unsubscribe = null;
    let resolved = false;

    const finalize = (session) => {
      const uid = session?.user?.id;
      resolved = true;
      if (!uid) {
        clearCurrentUser();
        if (alive) setUserId(null);
        router.replace('/login');
        window.setTimeout(() => {
          if (window.location.pathname !== '/login') window.location.replace('/login');
        }, 100);
        return;
      }
      setCurrentUser(uid);
      if (alive) {
        setUserId(uid);
        setUserReady(true);
      }
    };

    const getSessionWithTimeout = (timeoutMs = 1200) =>
      Promise.race([
        supabase.auth.getSession(),
        new Promise((resolve) => {
          window.setTimeout(() => resolve({ data: { session: null } }), timeoutMs);
        }),
      ]);

    (async () => {
      const { data } = await getSessionWithTimeout();
      if (data?.session?.user?.id) {
        finalize(data.session);
        return;
      }

      const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
        if (!alive) return;
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          finalize(session);
        }
        if (event === 'SIGNED_OUT') {
          finalize(null);
        }
      });

      unsubscribe = () => sub?.subscription?.unsubscribe?.();

      setTimeout(async () => {
        if (!alive || resolved) return;
        const { data: again } = await getSessionWithTimeout(800);
        finalize(again?.session || null);
      }, 1200);
    })();

    return () => {
      alive = false;
      if (unsubscribe) unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === 'en' || saved === 'ko') setLang(saved);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!userReady) return;

    let cancelled = false;

    (async () => {
      setIntroResolved(false);
      setVideoBlob(null);
      setVideoUrl(null);
      setVideoVisible(false);
      let localBlob = null;
      let hasPlayableVideo = false;

      try {
        localBlob = await loadLocalBlob(KEYS.INTRO_VIDEO);
        if (!cancelled && localBlob) {
          setVideoBlob(localBlob);
          hasPlayableVideo = true;
        }
      } catch {
        // ignore
      }

      if (!hasPlayableVideo) {
        let signedUrl = null;
        try {
          signedUrl = await getSignedAssetUrl(INTRO_ASSET_KEY, { expiresInSec: 60 * 30 });
        } catch {
          signedUrl = null;
        }

        if (!cancelled && signedUrl) {
          setVideoUrl(signedUrl);
          hasPlayableVideo = true;
        }
      }

      if (!cancelled) {
        setIntroResolved(true);
        setLoading(false);
      }

      if (hasPlayableVideo) {
        return;
      }

      try {
        const syncResult = await syncBlobFromCloud(KEYS.INTRO_VIDEO, {
          onRemoteDiff: () => {
            if (!cancelled && !hasPlayableVideo) setLoading(true);
          },
        });
        const syncedBlob = syncResult?.data || null;

        if (!cancelled && syncedBlob && !hasPlayableVideo) {
          setVideoBlob(syncedBlob);
          setVideoUrl(null);
          setIntroResolved(true);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) {
          setIntroResolved(true);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userReady, userId]);

  const hasStoredMenuLayout = useCallback(async (preferredLanguage, effectiveUserId) => {
    const preferredLang = preferredLanguage === 'ko' ? 'ko' : 'en';
    const languages = [preferredLang, fallbackLanguageFor(preferredLang)];

    for (const language of languages) {
      const readyBundle =
        readMenuReadyBundle(language, effectiveUserId) ||
        await withTimeout(readMenuReadyBundleAsync(language, effectiveUserId), 500, null);
      if (menuBundleVisuallyReady(readyBundle)) return true;
    }

    for (const language of languages) {
      const localLayout = await withTimeout(loadLocalJson(menuLayoutKey(language)), 700, null);
      if (isUsableMenuLayout(localLayout)) return true;
    }

    for (const language of languages) {
      const remoteLayout = await withTimeout(syncJsonFromCloud(menuLayoutKey(language)), 1800, null);
      if (isUsableMenuLayout(remoteLayout?.data)) return true;
    }

    return false;
  }, []);

  useEffect(() => {
    if (!userReady) return;
    try {
      router.prefetch('/menu');
    } catch {
      // ignore
    }
  }, [router, userReady]);

  const warmAllMenuLanguages = useCallback((preferredLanguage, overrideUserId = null) => {
    const effectiveUserId = overrideUserId || userId;
    if (!userReady && !effectiveUserId) return Promise.resolve();

    const preferredLang = preferredLanguage === 'ko' ? 'ko' : 'en';
    const languages = [preferredLang, fallbackLanguageFor(preferredLang)];

    const cacheKey = `${effectiveUserId || 'user'}:all-menu-languages`;
    const pending = pendingMenuWarmups.get(cacheKey);
    if (pending) return pending;

    const hydrateAllMedia = layoutMedia?.hydrateLayoutMedia;
    const migrateInlineMedia = layoutMedia?.migrateLegacyInlineMedia;
    const sanitizeLayoutMedia = layoutMedia?.sanitizeLayoutMedia;

    const work = withTimeout((async () => {
      const cachedBundles = {};
      await Promise.all(
        languages.map(async (language) => {
          cachedBundles[language] =
            readMenuReadyBundle(language, effectiveUserId) ||
            await withTimeout(readMenuReadyBundleAsync(language, effectiveUserId), 900, null);
        })
      );

      if (languages.every((language) => menuBundleVisuallyReady(cachedBundles[language]))) {
        return cachedBundles[preferredLang];
      }

      const rawLayouts = {};

      await Promise.all(
        languages.map(async (targetLang) => {
          const layoutKey = menuLayoutKey(targetLang);
          const localLayout = await withTimeout(loadLocalJson(layoutKey), 3000, null);
          const remoteLayout = await withTimeout(
            syncJsonFromCloud(layoutKey),
            localLayout ? 6000 : 12000,
            null
          );
          rawLayouts[targetLang] = remoteLayout?.data || localLayout || null;
        })
      );

      const warmLanguage = async (targetLang) => {
        if (menuBundleVisuallyReady(cachedBundles[targetLang])) return cachedBundles[targetLang];

        const fallbackLang = fallbackLanguageFor(targetLang);
        let rawLayout = rawLayouts[targetLang];
        const fallbackLayout = rawLayouts[fallbackLang];
        let repaired = { layout: rawLayout, changed: false };

        if (rawLayout && fallbackLayout) {
          repaired = repairMissingMediaItemsFromFallback(rawLayout, fallbackLayout);
          rawLayout = repaired.layout;
        }

        let hydratedLayout = null;
        let imagePreloadStats = null;
        let bgBlob = null;
        let bgOverrides = {};
        let bgObjectUrl = null;
        let bgSignedUrl = null;
        let bgOverrideSignedUrls = {};

        if (rawLayout && typeof migrateInlineMedia === 'function') {
          const migrated = await withTimeout(
            migrateInlineMedia(rawLayout),
            6000,
            { layout: rawLayout, changed: false }
          );
          rawLayout = migrated?.layout || rawLayout;
          repaired.changed = repaired.changed || !!migrated?.changed;
        }

        if (rawLayout && typeof hydrateAllMedia === 'function') {
          hydratedLayout = await withTimeout(hydrateAllMedia(rawLayout), 18000, null) || rawLayout;
          imagePreloadStats = await preloadImageUrlsUntilReady(getLayoutImageUrls(hydratedLayout));
        }

        const backgroundUrls = [];
        bgBlob = await withTimeout(loadLocalBlob(menuBgKey(targetLang)), 3000, null);
        bgObjectUrl = getReusableBlobObjectUrl(bgBlob);
        if (bgObjectUrl) {
          backgroundUrls.push(bgObjectUrl);
        }
        const defaultBgUrl = await withTimeout(
          getSignedAssetUrl(menuBgKey(targetLang), { expiresInSec: 60 * 60 * 2 }),
          6000,
          null
        );
        if (defaultBgUrl) {
          bgSignedUrl = defaultBgUrl;
          backgroundUrls.push(defaultBgUrl);
        }

        const overrides =
          (await withTimeout(loadLocalJson(bgOverridesKey(targetLang)), 3000, null)) ||
          (await withTimeout(syncJsonFromCloud(bgOverridesKey(targetLang)), 8000, null))?.data ||
          {};

        const overrideUrls = await Promise.all(
          Object.keys(overrides || {}).map(async (page) => {
            const pageNumber = Number(page);
            if (!Number.isFinite(pageNumber) || pageNumber < 1) return null;
            const signedUrl = await withTimeout(
              getSignedAssetUrl(bgPageKey(pageNumber, targetLang), { expiresInSec: 60 * 60 * 2 }),
              6000,
              null
            );
            if (signedUrl) bgOverrideSignedUrls[pageNumber] = signedUrl;
            return signedUrl;
          })
        );

        backgroundUrls.push(...overrideUrls.filter(Boolean));
        await withTimeout(preloadImageUrlsUntilReady(backgroundUrls, 2500), 3000, null);

        if (!hydratedLayout) {
          throw new Error(`Menu layout is not ready: ${targetLang}`);
        }

        if (repaired.changed && typeof sanitizeLayoutMedia === 'function') {
          await withTimeout(saveJson(menuLayoutKey(targetLang), sanitizeLayoutMedia(hydratedLayout)), 1800, null);
        }

        if (!imagePreloadStatsComplete(hydratedLayout, imagePreloadStats)) {
          console.warn('Menu images are not fully warmed yet', {
            language: targetLang,
            stats: imagePreloadStats,
          });
        }

        writeWindowReadyMenu({
          language: targetLang,
          userId: effectiveUserId,
          layout: hydratedLayout,
          bgBlob,
          bgOverrides,
          bgObjectUrl,
          bgSignedUrl,
          bgOverrideSignedUrls,
        });

        return await withTimeout(writeMenuReadyBundleAsync({
          language: targetLang,
          userId: effectiveUserId,
          layout: hydratedLayout,
          bgSignedUrl,
          bgOverrideSignedUrls,
          imagePreloadStats,
        }), 1800, null) || { ready: true, language: targetLang, at: Date.now() };
      };

      const preferredBundle = await warmLanguage(preferredLang);
      warmLanguage(fallbackLanguageFor(preferredLang)).catch((error) => {
        console.error('Background language warmup failed', error);
      });
      return preferredBundle;
    })(), MENU_WARMUP_MAX_WAIT_MS, null).finally(() => {
      pendingMenuWarmups.delete(cacheKey);
    });

    pendingMenuWarmups.set(cacheKey, work);
    return work;
  }, [userId, userReady]);

  const warmMenuLanguage = useCallback((targetLanguage, overrideUserId = null) => {
    if (!userReady && !overrideUserId && !userId) return Promise.resolve();

    const targetLang = targetLanguage === 'ko' ? 'ko' : 'en';
    return warmAllMenuLanguages(targetLang, overrideUserId || userId);
  }, [userId, userReady, warmAllMenuLanguages]);

  const uploadIntroVideo = async (file) => {
    if (!file) return;
    if (!String(file.type || '').startsWith('video/')) {
      setIntroUploadMessage(T.introUploadFail);
      return;
    }

    setIntroUploading(true);
    setIntroUploadMessage(T.introUploading);
    setVideoVisible(false);
    setVideoUrl(null);
    setVideoBlob(file);
    setIntroResolved(true);
    setLoading(false);
    try {
      await saveBlob(KEYS.INTRO_VIDEO, file);
      setIntroUploadMessage(T.introUploadDone);
    } catch (error) {
      console.error('Intro video upload failed', error);
      setIntroUploadMessage(T.introUploadFail);
    } finally {
      setIntroUploading(false);
      if (introUploadInputRef.current) introUploadInputRef.current.value = '';
    }
  };

  useEffect(() => {
    if (!videoBlob) return;

    const url = URL.createObjectURL(videoBlob);
    setVideoUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [videoBlob]);

  const playIntroVideo = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;

    v.muted = muted;
    if (v.readyState >= 2) setVideoVisible(true);

    try {
      await v.play();
      if (v.readyState >= 2) setVideoVisible(true);
    } catch (e) {
      console.log('Autoplay blocked:', e);
    }
  }, [muted]);

  useEffect(() => {
    if (!videoUrl) return;

    setVideoVisible(false);

    let cancelled = false;
    const timers = [0, 120, 600, 1500].map((delay) => window.setTimeout(() => {
      if (!cancelled) playIntroVideo();
    }, delay));

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [playIntroVideo, videoUrl]);

  useEffect(() => {
    if (!videoUrl) return undefined;

    const handleVisible = () => {
      if (!document.hidden) playIntroVideo();
    };

    window.addEventListener('focus', playIntroVideo);
    document.addEventListener('visibilitychange', handleVisible);

    return () => {
      window.removeEventListener('focus', playIntroVideo);
      document.removeEventListener('visibilitychange', handleVisible);
    };
  }, [playIntroVideo, videoUrl]);

  const goMenu = async (event) => {
    event?.preventDefault();
    if (menuLoading) return;
    setMenuLoading(true);

    try {
      let effectiveUserId = userId;
      if (!effectiveUserId) {
        const sessionResult = await withTimeout(supabase.auth.getSession(), 8000, null);
        effectiveUserId = sessionResult?.data?.session?.user?.id || null;
        if (effectiveUserId) {
          setCurrentUser(effectiveUserId);
          setUserId(effectiveUserId);
          setUserReady(true);
        }
      }

      if (!effectiveUserId) {
        router.replace('/login');
        return;
      }

      const hasExistingMenu =
        hasWindowReadyMenu(lang, effectiveUserId) ||
        menuBundleVisuallyReady(readMenuReadyBundle(lang, effectiveUserId)) ||
        await hasStoredMenuLayout(lang, effectiveUserId);

      if (!hasExistingMenu) {
        router.push('/menu?onboarding=1');
        window.setTimeout(() => {
          if (window.location.pathname !== '/menu') window.location.assign('/menu?onboarding=1');
        }, 500);
        return;
      }

      if (hasWindowReadyMenu(lang, effectiveUserId)) {
        warmMenuLanguage(lang, effectiveUserId).catch((error) => {
          console.error('Menu background warmup failed', error);
        });
      } else {
        try {
          await warmMenuLanguage(lang, effectiveUserId);
        } catch (error) {
          console.error('Menu warmup failed', error);
        }
      }

      const readyToOpen =
        hasWindowReadyMenu(lang, effectiveUserId) ||
        menuBundleVisuallyReady(readMenuReadyBundle(lang, effectiveUserId));

      if (!readyToOpen) {
        router.push('/menu?onboarding=1');
        window.setTimeout(() => {
          if (window.location.pathname !== '/menu') window.location.assign('/menu?onboarding=1');
        }, 500);
        return;
      }

      router.push('/menu');
      window.setTimeout(() => {
        if (window.location.pathname !== '/menu') window.location.assign('/menu');
      }, 500);
    } catch (error) {
      console.error('Go to menu failed', error);
      setMenuLoading(false);
    }
  };

  const setLanguage = (nextLang) => {
    setLang(nextLang);
    try {
      localStorage.setItem(LANG_KEY, nextLang);
    } catch {
      // ignore
    }
  };

  const toggleSound = async () => {
    const v = videoRef.current;
    if (!v) return;

    const nextMuted = !muted;
    setMuted(nextMuted);
    v.muted = nextMuted;

    try {
      await v.play();
    } catch (e) {
      console.log('Toggle sound failed:', e);
    }
  };

  const handleEnded = async () => {
    const v = videoRef.current;
    if (!v) return;

    try {
      v.currentTime = 0;
      await v.play();
    } catch (e) {
      console.log('Loop replay blocked:', e);
    }
  };

  const revealVideoFrame = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.readyState >= 2) {
      setVideoVisible(true);
    }
  };

  const handleVideoReady = () => {
    revealVideoFrame();
    playIntroVideo();
  };

  return (
    <div style={styles.container}>
      <div style={styles.langWrap}>
        <div style={styles.langRow}>
          <button
            style={{ ...styles.langButton, ...(lang === 'en' ? styles.langButtonActive : {}) }}
            onClick={() => setLanguage('en')}
            aria-label="English"
            title="English"
          >
            🇺🇸
          </button>
          <button
            style={{ ...styles.langButton, ...(lang === 'ko' ? styles.langButtonActive : {}) }}
            onClick={() => setLanguage('ko')}
            aria-label="한국어"
            title="한국어"
          >
            🇰🇷
          </button>
        </div>
      </div>

      {(
        <>
          {introResolved && !videoUrl && (
            <div style={styles.emptyIntroCard}>
              <div style={styles.emptyIntroContent}>
                <div>
                  <div style={styles.emptyIntroKicker}>Intro Setup</div>
                  <div style={styles.emptyIntroTitle}>{T.uploadIntroTitle}</div>
                  <div style={styles.emptyIntroDesc}>{T.uploadIntroDesc}</div>
                </div>
                <div
                  style={{ ...styles.introUploadZone, ...(introDragOver ? styles.introUploadZoneActive : {}) }}
                  role="button"
                  tabIndex={0}
                  onClick={() => introUploadInputRef.current?.click()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      introUploadInputRef.current?.click();
                    }
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setIntroDragOver(true);
                  }}
                  onDragLeave={() => setIntroDragOver(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIntroDragOver(false);
                    uploadIntroVideo(event.dataTransfer?.files?.[0]);
                  }}
                >
                  <div style={styles.introUploadIcon}>VIDEO</div>
                  <div style={styles.introUploadText}>{T.uploadIntroButton}</div>
                  <div style={styles.introUploadHint}>{T.uploadIntroDrop}</div>
                </div>
                <div style={styles.emptyIntroActions}>
                  <button
                    type="button"
                    style={{ ...styles.introUploadButton, ...(introUploading ? styles.introUploadButtonDisabled : {}) }}
                    onClick={() => introUploadInputRef.current?.click()}
                    disabled={introUploading}
                  >
                    {introUploading ? T.introUploading : T.uploadIntroButton}
                  </button>
                  <a
                    href="/menu"
                    onClick={goMenu}
                    style={{ ...styles.introSetupLink, ...(menuLoading ? styles.menuBtnDisabled : {}) }}
                    aria-disabled={menuLoading ? 'true' : undefined}
                  >
                    {menuLoading ? T.loadingMenu : T.skipToMenuSetup}
                  </a>
                </div>
                {introUploadMessage && (
                  <div style={{ ...styles.introUploadMessage, ...(introUploading ? styles.introUploadMessageBusy : {}) }}>
                    {introUploadMessage}
                  </div>
                )}
                <input
                  ref={introUploadInputRef}
                  type="file"
                  accept="video/*"
                  style={{ display: 'none' }}
                  onChange={(event) => uploadIntroVideo(event.target.files?.[0])}
                />
              </div>
            </div>
          )}

          {videoUrl && (
            <video
              ref={videoRef}
              key={videoUrl}
              src={videoUrl}
              poster={BLACK_POSTER}
              autoPlay
              muted={muted}
              playsInline
              preload="auto"
              loop
              disablePictureInPicture
              controlsList="nodownload noplaybackrate noremoteplayback"
              onPlay={revealVideoFrame}
              onPlaying={revealVideoFrame}
              onTimeUpdate={revealVideoFrame}
              onLoadedMetadata={handleVideoReady}
              onLoadedData={handleVideoReady}
              onCanPlay={handleVideoReady}
              onCanPlayThrough={handleVideoReady}
              onEnded={handleEnded}
              onError={() => {
                const v = videoRef.current;
                console.log('VIDEO_ERROR', v?.error?.code, v?.error?.message, videoUrl);
              }}
              style={videoVisible ? styles.video : styles.videoPreload}
            />
          )}

          {videoUrl && (
          <div style={styles.actionRow}>
            {videoUrl && (
              <button onClick={toggleSound} style={styles.soundBtn}>
                {muted ? T.soundOn : T.soundOff}
              </button>
            )}
            <a
              href="/menu"
              onClick={goMenu}
              style={{ ...styles.menuBtn, ...(menuLoading ? styles.menuBtnDisabled : {}) }}
              aria-disabled={menuLoading ? 'true' : undefined}
            >
              {menuLoading ? T.loadingMenu : T.goMenu}
            </a>
          </div>
          )}
        </>
      )}
    </div>
  );
}

const styles = {
  container: {
    width: '100vw',
    height: '100vh',
    background: '#000',
    overflow: 'hidden',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  langWrap: {
    position: 'fixed',
    top: 'calc(env(safe-area-inset-top, 0px) + 32px)',
    right: 'calc(env(safe-area-inset-right, 0px) + 20px)',
    zIndex: 99999,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    alignItems: 'flex-end',
  },
  langRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  langButton: {
    width: 42,
    height: 34,
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.26)',
    background: 'rgba(15,23,42,0.72)',
    cursor: 'pointer',
    fontSize: 18,
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 10px 24px rgba(0,0,0,0.28)',
    padding: 0,
  },
  langButtonActive: {
    border: '1px solid rgba(255,255,255,0.95)',
    background: 'rgba(15,118,110,0.82)',
  },
  emptyIntroCard: {
    position: 'relative',
    zIndex: 2,
    width: 'min(820px, calc(100vw - 36px))',
    maxHeight: 'calc(100dvh - 40px)',
    padding: 18,
    borderRadius: 28,
    background: 'linear-gradient(145deg, rgba(255,255,255,0.98), rgba(240,253,250,0.92))',
    border: '1px solid rgba(255,255,255,0.78)',
    color: '#111827',
    textAlign: 'left',
    boxShadow: '0 28px 80px rgba(0,0,0,0.38)',
    boxSizing: 'border-box',
    overflow: 'hidden',
  },
  emptyIntroContent: {
    display: 'grid',
    gridTemplateColumns: '1.05fr 0.95fr',
    gap: 18,
    alignItems: 'center',
  },
  emptyIntroKicker: {
    fontSize: 13,
    fontWeight: 950,
    letterSpacing: 0,
    color: '#0f766e',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  emptyIntroTitle: {
    fontSize: 'clamp(28px, 4vw, 44px)',
    lineHeight: 1.05,
    fontWeight: 950,
    marginBottom: 14,
  },
  emptyIntroDesc: {
    fontSize: 16,
    lineHeight: 1.55,
    fontWeight: 750,
    color: '#475569',
  },
  introUploadZone: {
    minHeight: 210,
    borderRadius: 24,
    border: '2px dashed rgba(15,118,110,0.30)',
    background: 'linear-gradient(145deg, rgba(15,118,110,0.08), rgba(15,23,42,0.04))',
    display: 'grid',
    placeItems: 'center',
    alignContent: 'center',
    gap: 10,
    padding: 22,
    boxSizing: 'border-box',
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'border-color 140ms ease, background 140ms ease, transform 140ms ease',
  },
  introUploadZoneActive: {
    borderColor: 'rgba(15,118,110,0.92)',
    background: 'linear-gradient(145deg, rgba(20,184,166,0.18), rgba(15,118,110,0.08))',
    transform: 'translateY(-1px)',
  },
  introUploadIcon: {
    width: 76,
    height: 76,
    borderRadius: 22,
    display: 'grid',
    placeItems: 'center',
    background: '#0f766e',
    color: '#fff',
    fontSize: 12,
    fontWeight: 1000,
    letterSpacing: 0.6,
    boxShadow: '0 18px 34px rgba(15,118,110,0.28)',
  },
  introUploadText: {
    fontSize: 20,
    lineHeight: 1.2,
    fontWeight: 950,
    color: '#0f172a',
  },
  introUploadHint: {
    maxWidth: 280,
    fontSize: 13,
    lineHeight: 1.4,
    fontWeight: 750,
    color: '#64748b',
  },
  emptyIntroActions: {
    gridColumn: '1 / -1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  introUploadButton: {
    minWidth: 190,
    height: 48,
    padding: '0 22px',
    borderRadius: 999,
    border: 0,
    background: '#0f766e',
    color: '#fff',
    cursor: 'pointer',
    fontSize: 15,
    fontWeight: 950,
    boxShadow: '0 16px 30px rgba(15,118,110,0.28)',
  },
  introUploadButtonDisabled: {
    opacity: 0.65,
    cursor: 'default',
  },
  introSetupLink: {
    minWidth: 174,
    height: 48,
    padding: '0 20px',
    borderRadius: 999,
    border: '1px solid rgba(15,23,42,0.12)',
    background: '#fff',
    color: '#0f172a',
    cursor: 'pointer',
    fontSize: 15,
    fontWeight: 950,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textDecoration: 'none',
    boxShadow: '0 10px 22px rgba(15,23,42,0.10)',
  },
  introUploadMessage: {
    gridColumn: '1 / -1',
    textAlign: 'center',
    fontSize: 13,
    fontWeight: 850,
    color: '#0f766e',
  },
  introUploadMessageBusy: {
    color: '#0369a1',
  },
  video: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    background: '#000',
    objectFit: 'contain',
    objectPosition: 'center center',
    opacity: 1,
    transform: 'translateZ(0)',
    backfaceVisibility: 'hidden',
  },
  videoPreload: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    background: '#000',
    objectFit: 'contain',
    objectPosition: 'center center',
    opacity: 0.01,
    pointerEvents: 'none',
    transform: 'translateZ(0)',
    backfaceVisibility: 'hidden',
  },
  actionRow: {
    position: 'absolute',
    right: 'calc(env(safe-area-inset-right, 0px) + 18px)',
    bottom: 'calc(env(safe-area-inset-bottom, 0px) + 18px)',
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    padding: 8,
    borderRadius: 999,
    background: 'rgba(15,23,42,0.68)',
    border: '1px solid rgba(255,255,255,0.14)',
    boxShadow: '0 18px 42px rgba(0,0,0,0.30)',
    backdropFilter: 'blur(10px)',
    transition: 'opacity 120ms ease-out',
  },
  soundBtn: {
    minWidth: 106,
    height: 40,
    padding: '0 14px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.18)',
    cursor: 'pointer',
    fontWeight: 900,
    background: 'rgba(255,255,255,0.10)',
    color: '#fff',
  },
  menuBtn: {
    minWidth: 106,
    height: 40,
    padding: '0 14px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.12)',
    cursor: 'pointer',
    fontWeight: 900,
    background: '#0f766e',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textDecoration: 'none',
  },
  menuBtnDisabled: {
    opacity: 0.72,
    pointerEvents: 'none',
  },
};
