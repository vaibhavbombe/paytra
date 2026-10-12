import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server (.next/standalone) with only the node_modules it
  // actually uses: a much smaller Docker image for Cloud Run.
  output: "standalone",
  // Don't advertise the framework in every response.
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Statement files are capped at 1 MB in code; leave room for the
      // multipart overhead on top of that.
      bodySizeLimit: "1100kb",
    },
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
