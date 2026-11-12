"use client";

import HomeDashboard from "./components/HomeDashboard";
import Explore from "./components/Explore";
import { useSession } from "../lib/session";

export default function HomePage() {
  const { user, ready } = useSession();

  return <>
    {!ready ? <main className="px-4 py-16 font-bold">Checking the door…</main> : user ? <HomeDashboard user={user} /> : <Explore user={null} />}
  </>;
}
