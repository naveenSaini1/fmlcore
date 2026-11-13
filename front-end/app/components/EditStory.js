"use client";

import { useState } from "react";
import { editPost } from "../../lib/api";

export default function EditStory({ post, onSave, onCancel }) {
  const [body, setBody] = useState(post.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (saving || !body.trim()) return;
    setSaving(true);
    setError("");
    try {
      onSave(await editPost(post.id, body.trim()));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return <form onSubmit={submit} className="post-body mt-3 space-y-2">
    <label className="block text-sm font-bold">
      {post.surface === "confession" ? "Edit confession" : "Edit post"}
      <textarea autoFocus required maxLength={1000} rows={5} value={body} disabled={saving} onChange={event => setBody(event.target.value)} className="mt-1 block w-full border-2 border-ink bg-white p-2" />
    </label>
    {error && <p role="alert" className="text-danger">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="submit" disabled={saving || !body.trim() || body.trim() === post.body} className="border-2 border-ink bg-lime px-3 py-2 text-sm font-bold disabled:opacity-50">{saving ? "Saving…" : "Save changes"}</button>
      <button type="button" onClick={onCancel} disabled={saving} className="border-2 border-ink bg-white px-3 py-2 text-sm font-bold">Cancel</button>
    </div>
  </form>;
}
