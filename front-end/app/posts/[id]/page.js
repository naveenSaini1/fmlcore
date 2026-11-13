"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import PostCard from "../../components/PostCard";
import { getPost } from "../../../lib/api";
import { useSession } from "../../../lib/session";

function Story() {
  const { id } = useParams();
  const comment = useSearchParams().get("comment");
  const { user, ready } = useSession();
  const [result, setResult] = useState(null);
  const scope = `${id}:${user?.id || "guest"}`;

  useEffect(() => {
    if (!ready) return;
    let active = true;
    getPost(id).then(post => {
      if (active) setResult({ scope, post });
    }).catch(error => {
      if (active) setResult({ scope, error: error.message });
    });
    return () => { active = false; };
  }, [id, ready, scope]);

  if (result?.scope !== scope || !ready) return <p role="status">Loading story…</p>;
  if (result.error) return <p role="alert">{result.error}</p>;

  return <PostCard key={`${scope}:${comment || ""}`} post={result.post} viewerId={user?.id} focusComment={comment} />;
}

export default function StoryPage() {
  return <main className="mx-auto max-w-3xl px-4 py-6">
    <Link href="/explore" className="mb-4 inline-block text-sm font-bold underline">Back to Explore</Link>
    <Suspense fallback={<p role="status">Loading story…</p>}><Story /></Suspense>
  </main>;
}
