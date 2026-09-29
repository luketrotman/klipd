import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "i.vimeocdn.com" }],
  },
};

export default nextConfig;
