import RouteTransitionLayer from '@/components/RouteTransitionLayer';

export const metadata = {
  title: "Menu Board App",
  description: "Digital Menu Board",
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          background: "#000",
          overflowX: 'hidden',
          WebkitTextSizeAdjust: '100%',
          textSizeAdjust: '100%',
        }}
      >
        {children}
        <RouteTransitionLayer />
      </body>
    </html>
  );
}
