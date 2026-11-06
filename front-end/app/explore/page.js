"use client";

import { useEffect, useState } from "react";
import Explore from "../components/Explore";
import { getMe } from "../../lib/api";

export default function ExplorePage() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    getMe().then(setUser).catch(() => setUser(null));
  }, []);

  return (
    <>
      <Explore user={user} />
    </>
  );
}
