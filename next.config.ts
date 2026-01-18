import type { NextConfig } from "next";

const nextConfig: NextConfig = {  // Disable dev indicators
  devIndicators: false,
  
  // Игнорируем ошибки от расширений браузера в dev режиме
  onDemandEntries: {
    maxInactiveAge: 60 * 1000,
    pagesBufferLength: 5,
  },
};

export default nextConfig;
