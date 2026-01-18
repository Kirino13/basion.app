import type { NextConfig } from "next";

const nextConfig: NextConfig = {  // Disable dev indicators
  devIndicators: false,
  
  // Ignore errors from browser extensions in dev mode
  onDemandEntries: {
    maxInactiveAge: 60 * 1000,
    pagesBufferLength: 5,
  },
};

export default nextConfig;
