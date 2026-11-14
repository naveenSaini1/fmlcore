"use client";

import Link from "next/link";
import HomeDashboard from "../components/HomeDashboard";
import { useSession } from "../../lib/session";

export default function YourSpacePage() {
  const { user, ready } = useSession();

  if (!ready) return <main className="px-4 py-16 font-bold">Opening Your Space…</main>;
  if (user) return <HomeDashboard user={user} />;
  return <main className="px-4 py-16 font-bold">
    <Link href="/login" className="underline">Log in to open Your Space</Link>
  </main>;
}
