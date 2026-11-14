"use client";

import Explore from "./components/Explore";
import { useSession } from "../lib/session";

export default function HomePage() {
  const { user, ready } = useSession();
  return <Explore user={user} sessionReady={ready} />;
}
