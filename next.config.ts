import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Отключаем все индикаторы разработки
  devIndicators: false,
  
  // Игнорируем ошибки от расширений браузера в dev режиме
  onDemandEntries: {
    maxInactiveAge: 60 * 1000,
    pagesBufferLength: 5,
  },
};

export default nextConfig;
