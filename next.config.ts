import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ['@react-pdf/renderer'],
};

export default nextConfig;
