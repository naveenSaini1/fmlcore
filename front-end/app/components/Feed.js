"use client";

import Composer from "./Composer";
import MyContent from "./MyContent";

export default function Feed({ user }) {
  return (
    <div className="space-y-6">
      <Composer user={user} onCreated={(post) => window.dispatchEvent(new CustomEvent("fmlcore:post-created", { detail: post }))} />
      <MyContent user={user} />
    </div>
  );
}
