export default function sitemap() {
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://fmlcore.com";
  return ["", "/explore", "/leaderboard", "/me"].map(path => ({ url: origin + path, changeFrequency: path === "/me" ? "monthly" : "daily", priority: path ? 0.7 : 1 }));
}
