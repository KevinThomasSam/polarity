import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/**": ["./migrations/**/*.sql"],
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
