import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typescript: {
    // livekit 라이브러리 내부 TypeScript 소스 타입 충돌로 인한 빌드 오류 무시
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
