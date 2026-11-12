"use client";

import Link from "next/link";
import PersonalSpace from "./PersonalSpace";
import { mediaUrl } from "../../lib/api";
import { profileColor, profileSticker } from "../../lib/profile-style";

export default function HomeDashboard({ user }) {
  const joined = user.joined_at ? new Date(user.joined_at).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : null;
  return <main className="home-dashboard">
    <header className="home-identity" style={{ "--profile-accent": profileColor(user.profile_color) }}>
      <div className="home-avatar-wrap">
        <img className="home-avatar" src={mediaUrl(user.avatar_url) || "/image/user.png"} alt={user.username + "'s profile photo"} />
        <span className="home-sticker" aria-label={(user.profile_sticker || "star") + " profile sticker"}>{profileSticker(user.profile_sticker)}</span>
      </div>
      <div className="home-identity-copy">
        <h1>@{user.username}</h1>
        <p className="home-bio">{user.bio || "Life happens. You can talk about it here."}</p>
        {joined && <p className="home-joined">Here since {joined}</p>}
      </div>
      <Link href="/profile" className="home-edit">Edit profile <span aria-hidden="true">↗</span></Link>
    </header>
    <div className="home-layout">
      <section className="home-stories" aria-label="Your Space">
        <PersonalSpace user={user} embedded />
      </section>
      <aside className="home-rail" aria-label="Make yourself at home">
        <section className="home-discover">
          <span className="home-discover-icon" aria-hidden="true">✳</span>
          <h2>A little less alone.</h2>
          <p>Someone out there has been there too.</p>
          <Link href="/explore">Find a familiar feeling <span aria-hidden="true">↗</span></Link>
        </section>
        <p className="home-footnote">Your stories. Your pace. Your space.</p>
      </aside>
    </div>
  </main>;
}
