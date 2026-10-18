import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The desktop build (desktop/build.mjs) runs the self-contained server inside Electron.
  // Its own distDir keeps it from replacing the build that tables.service serves from .next.
  output: process.env.NEXT_PUBLIC_TABLES_DESKTOP ? "standalone" : undefined,
  distDir: process.env.NEXT_PUBLIC_TABLES_DESKTOP ? ".next-desktop" : ".next",
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
