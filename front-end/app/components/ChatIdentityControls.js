"use client";

import { showErrorToast } from "./ErrorToast";
import { useEffect, useState } from "react";
import { updateChatIdentity } from "../../lib/chatApi";

export default function ChatIdentityControls({ conversation, onChange }) {
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmReveal, setConfirmReveal] = useState(false);
  useEffect(() => { setNickname(conversation.other_user.nickname || ""); setConfirmReveal(false); }, [conversation.id, conversation.other_user.nickname]);
  async function save(changes) {
    setBusy(true);
    try { onChange(await updateChatIdentity(conversation.id, changes)); setConfirmReveal(false); }
    catch (err) { showErrorToast(err.message); }
    finally { setBusy(false); }
  }
  return <details className="shrink-0 border-b-2 border-ink bg-paper px-4 py-2 text-sm">
    <summary className="cursor-pointer font-bold">Names & profile sharing · {conversation.my_profile_revealed ? "Your profile is shared" : "You are anonymous"}</summary>
    <div className="space-y-3 py-3">
      <p>Each person decides separately. Sharing applies only to this chat.</p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); save({ nickname }); }}>
        <label className="flex flex-col gap-1 font-bold">Private nickname <input maxLength={40} value={nickname} onChange={(e) => setNickname(e.target.value)} className="border-2 border-ink bg-white px-2 py-1" placeholder={conversation.other_user.alias} /></label>
        <button disabled={busy} className="border-2 border-ink bg-lime px-3 py-1 font-bold">Save nickname</button>
        <p className="w-full text-xs">Only you see this nickname. Leave blank to reset it.</p>
      </form>
      {conversation.my_profile_revealed ? <><p>Your username, photo, bio and profile link are visible to this person.</p><button disabled={busy} className="border-2 border-ink bg-white px-3 py-1 font-bold" onClick={() => save({ profile_revealed: false })}>Stop sharing my profile</button><p className="text-xs">They may already remember or have saved your profile.</p></> : confirmReveal ? <div className="border-2 border-ink bg-white p-3"><p>Share your username, profile photo, bio and public profile link with this person? Their identity stays private until they choose to share. They may remember or save your profile.</p><div className="mt-2 flex gap-2"><button disabled={busy} onClick={() => save({ profile_revealed: true })} className="border-2 border-ink bg-lime px-3 py-1 font-bold">Yes, share my profile</button><button disabled={busy} onClick={() => setConfirmReveal(false)} className="underline">Cancel</button></div></div> : <button disabled={busy} className="border-2 border-ink bg-white px-3 py-1 font-bold" onClick={() => setConfirmReveal(true)}>Reveal my profile</button>}
    </div>
  </details>;
}
