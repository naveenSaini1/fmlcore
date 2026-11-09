/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [{
      source: "/api/:path*",
      destination: `${process.env.API_ORIGIN || "http://127.0.0.1:8000"}/:path*`,
    }];
  },
};

export default nextConfig;
