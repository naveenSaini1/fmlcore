/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Verification builds must not overwrite a running dev server's manifest.
  distDir: process.env.NEXT_BUILD_DIR || ".next",
  async rewrites() {
    // Proxy API calls through this origin so the session cookie is first-party.
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_ORIGIN || "http://127.0.0.1:8000"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
