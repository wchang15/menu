'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

const START_EVENT = 'menu-route-transition-start';

export function startRouteTransition() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(START_EVENT));
}

export default function RouteTransitionLayer() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [solid, setSolid] = useState(false);
  const activeRef = useRef(false);
  const timersRef = useRef([]);

  const clearTimers = () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  };

  useEffect(() => {
    const handleStart = () => {
      clearTimers();
      activeRef.current = true;
      setVisible(true);
      window.requestAnimationFrame(() => setSolid(true));
    };

    window.addEventListener(START_EVENT, handleStart);
    return () => {
      window.removeEventListener(START_EVENT, handleStart);
      clearTimers();
    };
  }, []);

  useEffect(() => {
    if (!activeRef.current) return;

    clearTimers();
    timersRef.current.push(window.setTimeout(() => {
      setSolid(false);
      timersRef.current.push(window.setTimeout(() => {
        activeRef.current = false;
        setVisible(false);
      }, 120));
    }, 70));
  }, [pathname]);

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        background: 'rgba(0,0,0,0.28)',
        backdropFilter: solid ? 'blur(1.5px)' : 'blur(0px)',
        opacity: solid ? 1 : 0,
        transition: 'opacity 110ms ease, backdrop-filter 110ms ease',
        pointerEvents: 'none',
      }}
    />
  );
}
