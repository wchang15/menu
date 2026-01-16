export const metadata = {
  title: "Menu Board App",
  description: "Digital Menu Board"
};
export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, background: "#000" }}>{children}</body>
    </html>
  );
}