import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Disable dev indicators
  devIndicators: false,

  // Ignore errors from browser extensions in dev mode
  onDemandEntries: {
    maxInactiveAge: 60 * 1000,
    pagesBufferLength: 5,
  },

  // Ensure Base Build always reads the latest manifest (avoid stale edge caches)
  async headers() {
    return [
      {
        source: '/.well-known/farcaster.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
