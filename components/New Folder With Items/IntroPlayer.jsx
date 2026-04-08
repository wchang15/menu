'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KEYS, loadLocalBlob, saveBlob, syncBlobFromCloud } from '@/lib/storage';
import { getSignedAssetUrl, uploadAsset } from '@/lib/cloudAssets';
import { clearCurrentUser, setCurrentUser } from '@/lib/session';
import { supabase } from '@/lib/supabaseClient';

const LANG_KEY = 'APP_LANG_V1';
const INTRO_ASSET_KEY = 'intro-video';

export default function IntroPlayer() {
  const router = useRouter();
  const videoRef = useRef(null);

  const [videoBlob, setVideoBlob] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [videoVisible, setVideoVisible] = useState(false);
  const [muted, setMuted] = useState(true);
  const [loading, setLoading] = useState(true);
  // ✅ 로컬/클라우드에서 인트로가 "있는지" 확인되기 전까지는
  //    업로드 박스가 잠깐 뜨는 플래시를 막기 위한 상태
  const [introResolved, setIntroResolved] = useState(false);
  const [userReady, setUserReady] = useState(false);
  const [lang, setLang] = useState('en');

  const T = {
    soundOn: lang === 'ko' ? '소리 켜기' : 'Sound On',
    soundOff: lang === 'ko' ? '소리 끄기' : 'Sound Off',
    goMenu: lang === 'ko' ? '메뉴로' : 'Go to Menu',
  };

  useEffect(() => {
    let alive = true;
    let unsubscribe = null;

    const finalize = (session) => {
      const uid = session?.user?.id;
      if (!uid) {
        clearCurrentUser();
        router.replace('/login');
        return;
      }
      setCurrentUser(uid);
      if (alive) setUserReady(true);
    };

    (async () => {
      // 1) Fast path: already in memory/storage
      const { data } = await supabase.auth.getSession();
      if (data?.session?.user?.id) {
        finalize(data.session);
        return;
      }

      // 2) Mobile WebView: session restoration can lag behind mount.
      // Wait for INITIAL_SESSION (definitive) or SIGNED_IN.
      const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
        if (!alive) return;
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          finalize(session);
        }
      });

      unsubscribe = () => sub?.subscription?.unsubscribe?.();

      // Safety: if nothing happens, re-check once.
      setTimeout(async () => {
        if (!alive) return;
        const { data: again } = await supabase.auth.getSession();
        if (again?.session?.user?.id) finalize(again.session);
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

    const cacheBust = (url) => `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`;

    (async () => {
      // ✅ 로그인 직후: 아직 인트로가 있는지 없는지 확정 전
      setIntroResolved(false);
      let localBlob = null;

      // 1) 로컬 먼저: 여기서 바로 화면이 떠야 함
      try {
        localBlob = await loadLocalBlob(KEYS.INTRO_VIDEO);
        if (!cancelled && localBlob) setVideoBlob(localBlob);
      } catch {
        // ignore
      } finally {
        // 로컬이 있으면 여기서 바로 끝(바로 재생)
        if (!cancelled && localBlob) {
          setIntroResolved(true);
          setLoading(false);
        }
      }

      const hasLocal = !!localBlob;

      // 2) 원격 변경 체크 + 필요할 때만 다운로드 (버전 다를 때만)
      let syncedBlob = null;
      try {
        const syncResult = await syncBlobFromCloud(KEYS.INTRO_VIDEO, {
          onRemoteDiff: () => {
            if (!cancelled) setLoading(true);
          },
        });
        syncedBlob = syncResult?.data || null;

        if (!cancelled && syncedBlob) {
          setVideoBlob(syncedBlob);
          setVideoUrl(null); // blob URL 재생성 유도
          setIntroResolved(true);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) {
          // 로컬/원격 모두 확인 끝
          setIntroResolved(true);
          setLoading(false);
        }
      }

      // ✅ 여기부터 signed URL은 "필요할 때만" 1번만 받자
      const needStream = !hasLocal && !syncedBlob; // 로컬도 없고, sync로도 못 받았을 때만 스트리밍 허용
      const needDownloadToCache = !hasLocal && !syncedBlob; // 로컬 캐시가 아예 없을 때만 dl=1로 캐시 만들기 시도

      if (!needStream && !needDownloadToCache) return;

      let signedUrl = null;
      try {
        signedUrl = await getSignedAssetUrl(INTRO_ASSET_KEY, { expiresInSec: 60 * 30 });
      } catch {
        signedUrl = null;
      }
      if (cancelled || !signedUrl) return;

      // 3) 스트리밍 URL 세팅 (로컬이 없을 때만)
      if (needStream && !cancelled) {
        setVideoUrl(cacheBust(signedUrl));
      }

      // 4) 로컬이 없을 때만: dl=1로 내려받아 로컬 캐시 생성 (중복 다운로드 방지)
      if (needDownloadToCache) {
        fetch(`${signedUrl}${signedUrl.includes('?') ? '&' : '?'}dl=1`, { cache: 'no-store' })
          .then((r) => (r.ok ? r.blob() : null))
          .then((b) => {
            if (b) return saveBlob(KEYS.INTRO_VIDEO, b);
          })
          .catch(() => {});
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

  // blob -> objectURL (로컬/동기화 blob 재생)
  useEffect(() => {
    if (!videoBlob) return;

    const url = URL.createObjectURL(videoBlob);
    setVideoUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [videoBlob]);

  // 자동재생
  useEffect(() => {
    if (!videoUrl) return;

    setVideoVisible(false);

    const v = videoRef.current;
    if (!v) return;

    (async () => {
      try {
        await v.play();
      } catch (e) {
        console.log('Autoplay blocked:', e);
      }
    })();
  }, [videoUrl]);

  const upload = async (file) => {
    if (!file) return;
    try {
      await uploadAsset({ assetKey: INTRO_ASSET_KEY, file });
    } catch (error) {
      console.error(error);
    }
    await saveBlob(KEYS.INTRO_VIDEO, file);
    setVideoBlob(file);
    setVideoUrl(null);
  };

  const goMenu = () => router.push('/menu');

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
    if (!v.paused || v.currentTime > 0) {
      setVideoVisible(true);
    }
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

      {/* ✅ 확인 전/Blob->URL 변환 중에는 업로드 박스를 보여주지 않음(플래시 방지) */}
      {loading || !introResolved || (videoBlob && !videoUrl) ? null : !videoUrl ? (
        <div style={styles.uploadBox}>
          <input type="file" accept="video/*" onChange={(e) => upload(e.target.files?.[0])} />
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            key={videoUrl}
            src={videoUrl}
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
            onLoadedData={revealVideoFrame}
            onCanPlay={revealVideoFrame}
            onEnded={handleEnded}
            onError={() => {
              const v = videoRef.current;
              console.log('VIDEO_ERROR', v?.error?.code, v?.error?.message, videoUrl);
            }}
            style={{
              ...styles.video,
              opacity: videoVisible ? 1 : 0,
            }}
          />

          <div style={styles.actionRow}>
            <button onClick={toggleSound} style={styles.soundBtn}>
              {muted ? T.soundOn : T.soundOff}
            </button>
            <button onClick={goMenu} style={styles.menuBtn}>
              {T.goMenu}
            </button>
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
    gap: 12,
    alignItems: 'center',
  },
  langButton: {
    width: 56,
    height: 44,
    borderRadius: 14,
    border: '1px solid rgba(255,255,255,0.6)',
    background: 'rgba(0,0,0,0.48)',
    cursor: 'pointer',
    fontSize: 24,
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 6px 18px rgba(0,0,0,0.3)',
    padding: 0,
  },
  langButtonActive: {
    border: '1px solid rgba(255,255,255,0.95)',
    background: 'rgba(0,0,0,0.65)',
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
  uploadBox: {
    color: '#fff',
  },
  actionRow: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    display: 'flex',
    gap: 10,
    alignItems: 'center',
  },
  soundBtn: {
    padding: '10px 14px',
    borderRadius: 999,
    border: 'none',
    cursor: 'pointer',
    fontWeight: 700,
    background: 'rgba(255,255,255,0.9)',
  },
  menuBtn: {
    padding: '10px 14px',
    borderRadius: 999,
    border: 'none',
    cursor: 'pointer',
    fontWeight: 700,
    background: 'rgba(255,255,255,0.9)',
  },
};