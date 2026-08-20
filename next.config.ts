import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
