import localFont from "next/font/local";
import "./globals.css";

const syne = localFont({ src: "./fonts/syne.woff2", variable: "--font-syne", weight: "400 800", display: "swap" });
const outfit = localFont({ src: "./fonts/outfit.woff2", variable: "--font-outfit", weight: "100 900", display: "swap" });

export const metadata = {
  title: "FMLCore Admin",
  robots: { index: false, follow: false },
  description: "FMLCore operations console",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="acid-lime">
      <body className={`${syne.variable} ${outfit.variable}`}>{children}</body>
    </html>
  );
}
