import localFont from "next/font/local";
import { NavigationProgress, PageMotion } from "./components/PageMotion";
import SiteHeaderShell from "./components/SiteHeaderShell";
import BrowserNotifications from "./components/BrowserNotifications";
import ErrorToast from "./components/ErrorToast";
import { ThemeProvider } from "./components/ThemeProvider";
import { SkinProvider } from "./components/SkinProvider";
import { SessionProvider } from "../lib/session";
import { WebSocketProvider } from "../lib/websocket";
import "./globals.css";
import "./skins.css";
import "./common-ground.css";
import "./home-dashboard.css";
import "./theme-colors.css";
import "./mobile-navigation.css";
import "./post-card.css";
import "./leaderboard-panel.css";
import "./guest-appearance.css";

const syne = localFont({ src: "./fonts/syne.woff2", variable: "--font-syne", weight: "400 800", display: "swap" });
const outfit = localFont({ src: "./fonts/outfit.woff2", variable: "--font-outfit", weight: "100 900", display: "swap" });
const caveat = localFont({ src: "./fonts/caveat.woff2", variable: "--font-caveat", weight: "400 700", display: "swap" });
const inter = localFont({ src: "./fonts/inter.woff2", variable: "--font-inter", weight: "100 900", display: "swap" });
const poppins = localFont({ src: [{ path: "./fonts/poppins-400.woff2", weight: "400", style: "normal" }, { path: "./fonts/poppins-600.woff2", weight: "600", style: "normal" }, { path: "./fonts/poppins-700.woff2", weight: "700", style: "normal" }, { path: "./fonts/poppins-800.woff2", weight: "800", style: "normal" }], variable: "--font-poppins", display: "swap" });
const manrope = localFont({ src: "./fonts/manrope.woff2", variable: "--font-manrope", weight: "200 800", display: "swap" });

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://fmlcore.com"),
  title: { default: "FMLCore — Life happens. You're not alone.", template: "%s | FMLCore" },
  description: "Share funny, embarrassing and honest life stories. Find people who relate, explore confessions and connect through shared experiences on FMLCore. For adults 18+.",
  applicationName: "FMLCore",
  openGraph: { type: "website", siteName: "FMLCore", locale: "en_US", title: "FMLCore — Life happens. You're not alone.", description: "Funny, messy, honest life stories. Find someone who gets it." },
  twitter: { card: "summary_large_image", title: "FMLCore", description: "Life is weird. You're not the only one." },
  robots: { index: true, follow: true },
};

export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="acid-lime" data-skin="calm">
      <body className={`${syne.variable} ${outfit.variable} ${caveat.variable} ${inter.variable} ${poppins.variable} ${manrope.variable} antialiased`}>
        <SessionProvider>
          <SkinProvider>
            <ThemeProvider>
              <WebSocketProvider>
                <SiteHeaderShell />
                <BrowserNotifications />
                <NavigationProgress />
                <ErrorToast />
                <PageMotion>{children}</PageMotion>
              </WebSocketProvider>
            </ThemeProvider>
          </SkinProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
