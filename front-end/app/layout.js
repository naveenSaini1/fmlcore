import { Caveat, Inter, Manrope, Outfit, Poppins, Syne } from "next/font/google";
import { NavigationProgress, PageMotion } from "./components/PageMotion";
import SiteHeaderShell from "./components/SiteHeaderShell";
import { ThemeProvider } from "./components/ThemeProvider";
import { SkinProvider } from "./components/SkinProvider";
import { WebSocketProvider } from "../lib/websocket";
import "./globals.css";
import "./skins.css";
import "./common-ground.css";

const syne = Syne({ subsets: ["latin"], variable: "--font-syne", weight: ["600", "700", "800"] });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", weight: ["400", "600", "700"] });
const caveat = Caveat({ subsets: ["latin"], variable: "--font-caveat", weight: ["600", "700"] });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const poppins = Poppins({ subsets: ["latin"], variable: "--font-poppins", weight: ["400", "600", "700", "800"] });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });

export const metadata = {
  title: "FMLCore",
  description: "Life is weird. You're not the only one.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="acid-lime" data-skin="calm">
      <body className={`${syne.variable} ${outfit.variable} ${caveat.variable} ${inter.variable} ${poppins.variable} ${manrope.variable} antialiased`}>
        <SkinProvider>
          <ThemeProvider>
            <WebSocketProvider>
              <SiteHeaderShell />
              <NavigationProgress />
              <PageMotion>{children}</PageMotion>
            </WebSocketProvider>
          </ThemeProvider>
        </SkinProvider>
      </body>
    </html>
  );
}
