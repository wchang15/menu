'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import IntroPlayer from './IntroPlayer';
import MenuEditor from './MenuEditor';

function normalizeView(value) {
  return value === 'intro' ? 'intro' : 'menu';
}

function viewFromPathname() {
  if (typeof window === 'undefined') return 'menu';
  return window.location.pathname === '/intro' ? 'intro' : 'menu';
}

export default function MenuIntroShell({ initialView = 'menu' }) {
  const [view, setView] = useState(() => normalizeView(initialView));
  const shellStyle = useMemo(() => ({
    width: '100vw',
    height: '100vh',
    overflow: 'hidden',
    position: 'relative',
    background: '#000',
  }), []);

  const getPaneStyle = useCallback((paneView) => ({
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    opacity: view === paneView ? 1 : 0,
    visibility: view === paneView ? 'visible' : 'hidden',
    pointerEvents: view === paneView ? 'auto' : 'none',
    zIndex: view === paneView ? 2 : 1,
    transition: 'none',
    transform: 'translateZ(0)',
    contain: 'layout paint size',
  }), [view]);

  useEffect(() => {
    setView(viewFromPathname());

    const handlePopState = () => setView(viewFromPathname());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const goIntro = useCallback(() => {
    if (typeof window !== 'undefined' && window.location.pathname !== '/intro') {
      window.history.pushState(null, '', '/intro');
    }
    setView('intro');
  }, []);

  const goMenu = useCallback((href = '/menu') => {
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', href || '/menu');
    }
    setView('menu');
  }, []);

  return (
    <div style={shellStyle}>
      <section aria-hidden={view !== 'menu'} style={getPaneStyle('menu')}>
        <MenuEditor navigateToIntro={goIntro} />
      </section>
      <section aria-hidden={view !== 'intro'} style={getPaneStyle('intro')}>
        <IntroPlayer navigateToMenu={goMenu} />
      </section>
    </div>
  );
}
