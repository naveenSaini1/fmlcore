export default function robots() {
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://fmlcore.com";
  return { rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/profile", "/chat", "/notifications", "/same-sky", "/settings", "/login", "/signup"] }, sitemap: `${origin}/sitemap.xml` };
}
