import { Outfit, Syne } from "next/font/google";
import "./globals.css";

const syne = Syne({ subsets: ["latin"], variable: "--font-syne", weight: ["600", "700", "800"] });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", weight: ["400", "500", "600", "700", "800"] });

export const metadata = {
  title: "FMLCore Admin",
  description: "FMLCore operations console",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="acid-lime">
      <body className={`${syne.variable} ${outfit.variable}`}>{children}</body>
    </html>
  );
}
