import { Caveat, Outfit, Syne } from "next/font/google";
import { NavigationProgress, PageMotion } from "./components/PageMotion";
import SiteHeaderShell from "./components/SiteHeaderShell";
import { ThemeProvider } from "./components/ThemeProvider";
import "./globals.css";

const syne = Syne({ subsets: ["latin"], variable: "--font-syne", weight: ["600", "700", "800"] });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", weight: ["400", "600", "700"] });
const caveat = Caveat({ subsets: ["latin"], variable: "--font-caveat", weight: ["600", "700"] });

export const metadata = {
  title: "FMLCore",
  description: "Life is weird. You're not the only one.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="system">
      <body className={`${syne.variable} ${outfit.variable} ${caveat.variable} antialiased`}>
        <ThemeProvider>
          <SiteHeaderShell />
          <NavigationProgress />
          <PageMotion>{children}</PageMotion>
        </ThemeProvider>
      </body>
    </html>
  );
}
