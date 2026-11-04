"use client";

import { useEffect, useState } from "react";
import SiteHeader from "../components/SiteHeader";
import Explore from "../components/Explore";
import { getMe } from "../../lib/api";

export default function ExplorePage() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    getMe().then(setUser).catch(() => setUser(null));
  }, []);

  return (
    <>
      <SiteHeader user={user} />
      <Explore user={user} />
    </>
  );
}
