"use client";

import { useEffect, useState } from "react";
import PersonalSpace from "./components/PersonalSpace";
import Explore from "./components/Explore";
import { getMe } from "../lib/api";

export default function HomePage() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    getMe().then(setUser).catch(() => setUser(null)).finally(() => setReady(true));
  }, []);

  return <>
    {!ready ? <main className="px-4 py-16 font-bold">Checking the door…</main> : user ? <PersonalSpace user={user} /> : <Explore user={null} />}
  </>;
}
