"use client";

import SiteHeader from "./SiteHeader";
import { useSession } from "../../lib/session";

export default function SiteHeaderShell() {
  const { user } = useSession();
  return <SiteHeader user={user} />;
}
