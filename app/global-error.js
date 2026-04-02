'use client';

import { useEffect } from 'react';

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error('Global error:', error);
  }, [error]);

  return (
    <html>
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          background: '#111',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          fontFamily: 'Arial, sans-serif',
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: 560 }}>
          <h2 style={{ marginBottom: 12 }}>A critical error occurred.</h2>
          <p style={{ opacity: 0.8, marginBottom: 20 }}>
            The app could not render properly.
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
      </body>
    </html>
  );
}