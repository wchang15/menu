/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
  
    // ✅ iOS 앱에 넣기 좋은 정적 산출물(out) 생성
    output: "export",
  
    // ✅ export에서 이미지 최적화 서버가 없으니 끔
    images: { unoptimized: true },
  
    // (선택) 경로 안정화
    trailingSlash: true,
  };
  
  module.exports = nextConfig;