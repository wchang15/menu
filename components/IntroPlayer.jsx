'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KEYS, loadLocalBlob, loadLocalJson, saveJson, syncBlobFromCloud, syncJsonFromCloud } from '@/lib/storage';
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
const MENU_WARMUP_MAX_WAIT_MS = 30000;
const pendingMenuWarmups = new Map();
const WINDOW_READY_VIEW_STORE = '__MENU_READY_VIEW_STORE_V1__';
const BLACK_POSTER = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="100%" height="100%" fill="black"/></svg>'
)}`;

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

function hasWindowReadyMenu(language, userId) {
  if (typeof window === 'undefined') return false;
  try {
    const store = window[WINDOW_READY_VIEW_STORE];
    const safeLang = language === 'ko' ? 'ko' : 'en';
    const exact = store?.get?.(`${userId || 'user'}:${safeLang}`);
    if (exact?.userId && exact.userId !== userId) return false;
    return exact?.layout?.mode === 'custom' || exact?.layout?.mode === 'template';
  } catch {
    return false;
  }
}

function isBlobUrlSrc(value) {
  return typeof value === 'string' && value.startsWith('blob:');
}

function isMediaItem(item) {
  return item && (item.type === 'image' || item.type === 'video');
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

  const [videoBlob, setVideoBlob] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [videoVisible, setVideoVisible] = useState(false);
  const [muted, setMuted] = useState(true);
  const [loading, setLoading] = useState(true);
  const [introResolved, setIntroResolved] = useState(false);
  const [userReady, setUserReady] = useState(false);
  const [userId, setUserId] = useState(null);
  const [lang, setLang] = useState('en');
  const [preparingMenu, setPreparingMenu] = useState(false);

  const T = {
    soundOn: lang === 'ko' ? '소리 켜기' : 'Sound On',
    soundOff: lang === 'ko' ? '소리 끄기' : 'Sound Off',
    goMenu: lang === 'ko' ? '메뉴로' : 'Go to Menu',
    preparingMenu: lang === 'ko' ? '메뉴 준비 중...' : 'Preparing Menu...',
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
  }, [userReady]);

  useEffect(() => {
    if (!userReady) return;
    try {
      router.prefetch('/menu');
    } catch {
      // ignore
    }
  }, [router, userReady]);

  const warmAllMenuLanguages = useCallback((preferredLanguage) => {
    if (!userReady) return Promise.resolve();

    const preferredLang = preferredLanguage === 'ko' ? 'ko' : 'en';
    const languages = [preferredLang, fallbackLanguageFor(preferredLang)];

    const cacheKey = `${userId || 'user'}:all-menu-languages`;
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
            readMenuReadyBundle(language, userId) ||
            await withTimeout(readMenuReadyBundleAsync(language, userId), 900, null);
        })
      );

      if (languages.every((language) => cachedBundles[language])) {
        return cachedBundles[preferredLang];
      }

      const rawLayouts = {};

      await Promise.all(
        languages.map(async (targetLang) => {
          const layoutKey = menuLayoutKey(targetLang);
          const localLayout = await withTimeout(loadLocalJson(layoutKey), 1200, null);
          const remoteLayout = localLayout
            ? null
            : await withTimeout(syncJsonFromCloud(layoutKey), 2500, null);
          rawLayouts[targetLang] = localLayout || remoteLayout?.data || null;
        })
      );

      const warmLanguage = async (targetLang) => {
        if (cachedBundles[targetLang]) return cachedBundles[targetLang];

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
        let bgSignedUrl = null;
        let bgOverrideSignedUrls = {};

        if (rawLayout && typeof migrateInlineMedia === 'function') {
          const migrated = await withTimeout(
            migrateInlineMedia(rawLayout),
            2500,
            { layout: rawLayout, changed: false }
          );
          rawLayout = migrated?.layout || rawLayout;
          repaired.changed = repaired.changed || !!migrated?.changed;
        }

        if (rawLayout && typeof hydrateAllMedia === 'function') {
          hydratedLayout = await withTimeout(hydrateAllMedia(rawLayout), 5000, null) || rawLayout;
          imagePreloadStats = await preloadImageUrlsUntilReady(getLayoutImageUrls(hydratedLayout));
        }

        const backgroundUrls = [];
        const defaultBgUrl = await withTimeout(
          getSignedAssetUrl(menuBgKey(targetLang), { expiresInSec: 60 * 60 * 2 }),
          1800,
          null
        );
        if (defaultBgUrl) {
          bgSignedUrl = defaultBgUrl;
          backgroundUrls.push(defaultBgUrl);
        }

        const overrides =
          (await withTimeout(loadLocalJson(bgOverridesKey(targetLang)), 1200, null)) ||
          (await withTimeout(syncJsonFromCloud(bgOverridesKey(targetLang)), 2500, null))?.data ||
          {};

        const overrideUrls = await Promise.all(
          Object.keys(overrides || {}).map(async (page) => {
            const pageNumber = Number(page);
            if (!Number.isFinite(pageNumber) || pageNumber < 1) return null;
            const signedUrl = await withTimeout(
              getSignedAssetUrl(bgPageKey(pageNumber, targetLang), { expiresInSec: 60 * 60 * 2 }),
              1800,
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

        return await withTimeout(writeMenuReadyBundleAsync({
          language: targetLang,
          userId,
          layout: hydratedLayout,
          bgSignedUrl,
          bgOverrideSignedUrls,
          imagePreloadStats,
        }), 1800, null) || { ready: true, language: targetLang, at: Date.now() };
      };

      const bundles = await Promise.all(languages.map((targetLang) => warmLanguage(targetLang)));
      return bundles[0];
    })(), MENU_WARMUP_MAX_WAIT_MS, null).finally(() => {
      pendingMenuWarmups.delete(cacheKey);
    });

    pendingMenuWarmups.set(cacheKey, work);
    return work;
  }, [userId, userReady]);

  const warmMenuLanguage = useCallback((targetLanguage) => {
    if (!userReady) return Promise.resolve();

    const targetLang = targetLanguage === 'ko' ? 'ko' : 'en';
    return warmAllMenuLanguages(targetLang);
  }, [userReady, warmAllMenuLanguages]);

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
    if (preparingMenu) {
      event?.preventDefault();
      return;
    }
    event?.preventDefault();
    setPreparingMenu(true);

    router.push('/menu');
    window.setTimeout(() => {
      if (window.location.pathname !== '/menu') window.location.assign('/menu');
    }, 500);

    if (!hasWindowReadyMenu(lang, userId)) {
      warmMenuLanguage(lang).catch((error) => {
        console.error('Menu warmup failed; opening menu with available cache', error);
      });
    }

    window.setTimeout(() => setPreparingMenu(false), 1200);
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

          <div style={styles.actionRow}>
            {videoUrl && (
              <button onClick={toggleSound} style={styles.soundBtn}>
                {muted ? T.soundOn : T.soundOff}
              </button>
            )}
            <a
              href="/menu"
              onClick={goMenu}
              style={{ ...styles.menuBtn, ...(preparingMenu ? styles.menuBtnDisabled : {}) }}
              aria-disabled={preparingMenu ? 'true' : undefined}
            >
              {preparingMenu ? T.preparingMenu : T.goMenu}
            </a>
          </div>
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
