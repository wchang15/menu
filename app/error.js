'use client';

import { useEffect } from 'react';

export default function Error({ error, reset }) {
  useEffect(() => {
    console.error('App error:', error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#111',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <h2 style={{ marginBottom: 12 }}>Something went wrong.</h2>
      <p style={{ opacity: 0.8, marginBottom: 20 }}>
        Please try refreshing the page.
      </p>
      <button
        onClick={() => reset()}
        style={{
          padding: '10px 16px',
          borderRadius: 10,
          border: 'none',
          background: '#fff',
          color: '#111',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Try again
      </button>
    </div>
  );
}