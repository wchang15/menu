'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KEYS, loadBlob, saveBlob } from '@/lib/storage';
import { getSignedAssetUrl, uploadAsset } from '@/lib/cloudAssets';
import { getCurrentUser } from '@/lib/session';

const LANG_KEY = 'APP_LANG_V1';
const INTRO_ASSET_KEY = 'intro-video';

export default function IntroPlayer() {
  const router = useRouter();
  const videoRef = useRef(null);

  const [videoBlob, setVideoBlob] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [muted, setMuted] = useState(true); // 처음엔 음소거
  const [loading, setLoading] = useState(true);
  const [userReady, setUserReady] = useState(false);
  const [lang, setLang] = useState('en');

  const T = {
    soundOn: lang === 'ko' ? '소리 켜기' : 'Sound On',
    soundOff: lang === 'ko' ? '소리 끄기' : 'Sound Off',
    goMenu: lang === 'ko' ? '메뉴로' : 'Go to Menu',
  };

  useEffect(() => {
    const current = getCurrentUser();
    if (!current) {
      router.replace('/login');
      return;
    }
    setUserReady(true);
  }, [router]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === 'en' || saved === 'ko') {
        setLang(saved);
      }
    } catch {
      // ignore
    }
  }, []);


  // ✅ 인트로 비디오 로드
  // - 먼저 Signed URL(스트리밍)로 시도 → 매우 빠름(전체 Blob 다운로드 안 함)
  // - 없으면 로컬 캐시(Blob) fallback
  useEffect(() => {
    if (!userReady) return;

    // ✅ 0.1s 체감 목표: 로컬 캐시를 먼저 즉시 보여주고, 원격은 백그라운드로 갱신
    let cancelled = false;

    (async () => {
      try {
        // 1) 로컬 캐시 (오프라인/즉시 렌더)
        const localBlob = await loadBlob(KEYS.INTRO_VIDEO);
        if (!cancelled && localBlob) setVideoBlob(localBlob);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }

      // 2) 원격 signed URL은 뒤에서 받아서 (가능하면) 스트리밍 + 캐시 갱신
      try {
        const signedUrl = await getSignedAssetUrl(INTRO_ASSET_KEY, { expiresInSec: 60 * 30 });
        if (!cancelled && signedUrl) {
          // 캐시 버스터(특히 iOS WebView)
          setVideoUrl(`${signedUrl}${signedUrl.includes('?') ? '&' : '?'}v=${Date.now()}`);

          // ✅ 오프라인 대비: 백그라운드로 파일을 내려받아 로컬 캐시에 저장(네트워크가 느려도 UX를 막지 않음)
          // iOS WebView에서 큰 파일은 시간이 걸릴 수 있으니 실패해도 무시
          fetch(`${signedUrl}${signedUrl.includes('?') ? '&' : '?'}dl=1`, { cache: 'no-store' })
            .then((r) => (r.ok ? r.blob() : null))
            .then((b) => {
              if (b) return saveBlob(KEYS.INTRO_VIDEO, b);
            })
            .catch(() => {});
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userReady]);

  // blob -> objectURL (로컬 fallback일 때만)
  useEffect(() => {
    if (!videoBlob) {
      return;
    }

    // 이미 Signed URL로 세팅된 경우엔 덮어쓰지 않음
    if (videoUrl) return;

    const url = URL.createObjectURL(videoBlob);
    setVideoUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [videoBlob, videoUrl]);

  // 자동재생 시도
  useEffect(() => {
    if (!videoUrl) return;
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
    // 업로드 직후에는 로컬 Blob로 즉시 반영(UX)
    setVideoBlob(file);
    setVideoUrl(null); // blob URL 재생성 유도
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

  // 🔁 Sound On / Off 토글
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

  // ✅ 끝나면 메뉴로 가지 말고 다시 재생(루프 보강)
  const handleEnded = async () => {
    const v = videoRef.current;
    if (!v) return;

    try {
      v.currentTime = 0;
      await v.play();
    } catch (e) {
      // 일부 브라우저에서 autoplay 정책 때문에 실패할 수 있음
      console.log('Loop replay blocked:', e);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.langWrap}>
        <div style={styles.langRow}>
          <button
            style={{
              ...styles.langButton,
              ...(lang === 'en' ? styles.langButtonActive : {}),
            }}
            onClick={() => setLanguage('en')}
            aria-label="English"
            title="English"
          >
            🇺🇸
          </button>
          <button
            style={{
              ...styles.langButton,
              ...(lang === 'ko' ? styles.langButtonActive : {}),
            }}
            onClick={() => setLanguage('ko')}
            aria-label="한국어"
            title="한국어"
          >
            🇰🇷
          </button>
        </div>
      </div>
      {loading ? null : !videoUrl ? (
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
            loop // ✅ 기본 루프
            onEnded={handleEnded} // ✅ 루프가 안 먹는 환경 대비 보강
            style={styles.video}
          />

          {/* 오른쪽 하단 버튼 */}
          <div style={styles.actionRow}>
            <button onClick={toggleSound} style={styles.soundBtn}>
              {muted ? T.soundOn : T.soundOff}
            </button>

            {/* ✅ SKIP 대신 Go to Menu */}
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