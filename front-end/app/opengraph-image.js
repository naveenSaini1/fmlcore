import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "FMLCore — life happens. You're not alone.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const logo = await readFile(join(process.cwd(), "public/image/logo.png"));
  return new ImageResponse(<div style={{ width: "100%", height: "100%", background: "#c4f135", color: "#171717", padding: 72, display: "flex", flexDirection: "column", border: "16px solid #171717", fontFamily: "sans-serif" }}>
    <img src={`data:image/png;base64,${logo.toString("base64")}`} alt="" width="190" height="76" />
    <div style={{ display: "flex", fontSize: 110, fontWeight: 700, marginTop: 30 }}>FMLCore</div>
    <div style={{ display: "flex", fontSize: 48, marginTop: 20 }}>Life happens. You're not alone.</div>
    <div style={{ display: "flex", fontSize: 28, marginTop: 30 }}>Funny, messy, honest stories. For adults 18+.</div>
  </div>, size);
}
