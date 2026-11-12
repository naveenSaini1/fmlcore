"use client";

import Explore from "../components/Explore";
import { useSession } from "../../lib/session";

export default function ExplorePage() {
  const { user } = useSession();

  return (
    <>
      <Explore user={user} />
    </>
  );
}
