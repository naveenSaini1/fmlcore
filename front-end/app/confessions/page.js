"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createConfession, getConfessions, getMe, getRandomConfession, viewConfession } from "../../lib/api";
import { CATEGORIES, MOODS } from "../../lib/taxonomy";
import PostCard from "../components/PostCard";
import "./sky.css";
import "./interaction.css";

const COLORS = ["pink", "purple", "lime", "coral", "blue", "yellow", "orange", "mint", "lavender"];
const EMPTY_SKY = ["pink", "blue", "lavender", "mint", "yellow", "coral", "purple", "orange"];

function Balloon({ post, index, onPick, selected, onPop }) {
  const [popped, setPopped] = useState(false);
  const duration = 18 + (index % 6) * 2;
  const style = { "--x": `${6 + ((index * 17) % 86)}%`, "--delay": `${-((index % 18) / 18) * duration}s`, "--duration": `${duration}s`, "--size": `${.72 + (index % 4) * .12}` };
  return <button type="button" aria-label={post.body ? `Pop confession: ${post.body.slice(0, 60)}` : "Release the first confession"} onClick={async () => { if (!post.id) return onPick?.(post); if (popped) return; setPopped(true); try { const viewed = await viewConfession(post.id); onPop?.(viewed); setTimeout(() => onPick?.(viewed), 320); } catch { setPopped(false); } }} className={`sky-balloon ${selected ? "is-selected" : ""} ${popped ? "is-popping" : ""}`} style={style}>
    <span className={`balloon-body balloon-${post.balloon_color || "pink"}`}><i /></span><span className="balloon-knot" /><span className="balloon-string" /><span className="balloon-tag">{post.category.slice(0, 2).toUpperCase()}<small>{post.view_count || 0} views</small></span>
  </button>;
}

export default function ConfessionSkyPage() {
  const [user, setUser] = useState(null), [posts, setPosts] = useState([]), [cursor, setCursor] = useState(null), [selected, setSelected] = useState(null), [open, setOpen] = useState(false), [error, setError] = useState(""), [popMessage, setPopMessage] = useState("");
  const [form, setForm] = useState({ body: "", category: "Confessions", mood: "soft", isAnonymous: true, visibility: "public", balloonColor: "pink" });
  const [sending, setSending] = useState(false);
  const visible = useMemo(() => posts.slice(0, 30), [posts]);
  useEffect(() => { getMe().then(setUser).catch(() => setUser(null)); getConfessions().then((d) => { setPosts(d.posts); setCursor(d.next_cursor); }).catch((e) => setError(e.message)); }, []);
  async function random() { const post = await getRandomConfession(); if (post) setSelected(post); }
  function updateViewed(post) { setPosts((items) => items.map((item) => item.id === post.id ? post : item)); setPopMessage(`You popped it · ${post.view_count} views`); window.setTimeout(() => setPopMessage(""), 2600); }
  async function submit(e) { e.preventDefault(); if (!user) return setError("Log in to release a balloon."); setSending(true); setError(""); try { const post = await createConfession(form); if (post.visibility === "public") setPosts((p) => [post, ...p]); setSelected(post); setOpen(false); setForm((f) => ({ ...f, body: "" })); } catch (err) { setError(err.message); } finally { setSending(false); } }
  return <main className="confession-sky"><header className="sky-header"><Link href="/" className="sky-close">← feed</Link><div><b>FMLCore</b><h1>THE CONFESSION SKY</h1><p>Some things are easier to tell strangers.</p></div><button onClick={() => setOpen(true)} className="release">+ RELEASE A BALLOON</button></header><section className="sky-layout"><div className="sky-canvas" aria-label="Floating public confessions">{visible.map((p, i) => <Balloon key={p.id} post={p} index={i} selected={selected?.id === p.id} onPick={setSelected} onPop={updateViewed} />)}{!visible.length && !error ? <><div className="empty-balloons" aria-hidden>{EMPTY_SKY.map((color, i) => <Balloon key={color} index={i} post={{ balloon_color: color, category: "NEW" }} onPick={() => setOpen(true)} />)}</div><p className="sky-empty">The sky is waiting for its first real confession.</p></> : null}<button onClick={random} className="sky-random">Find me something random</button>{cursor ? <button className="sky-more" onClick={() => getConfessions(cursor).then((d) => { setPosts((p) => [...p, ...d.posts]); setCursor(d.next_cursor); })}>More balloons</button> : null}</div><aside className="sky-detail">{selected ? <><button onClick={() => setSelected(null)} className="detail-close">× close</button><PostCard post={selected} viewerId={user?.id} /></> : <div className="sky-intro"><span>☁</span><h2>Pick a balloon</h2><p>Every tag holds a thought someone needed to release.</p></div>}</aside></section>{open ? <div className="composer-backdrop"><form onSubmit={submit} className="sky-composer"><button type="button" onClick={() => setOpen(false)} className="detail-close">× close</button><h2>LET IT OUT.</h2><p>What&apos;s been living inside your head?</p><textarea required maxLength="1000" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="write it down…" /><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map((x) => <option key={x}>{x}</option>)}</select><select value={form.mood} onChange={(e) => setForm({ ...form, mood: e.target.value })}>{MOODS.map((x) => <option key={x.key} value={x.key}>{x.emoji} {x.label}</option>)}</select><div className="color-picks">{COLORS.map((c) => <button type="button" key={c} onClick={() => setForm({ ...form, balloonColor: c })} className={`pick balloon-${c} ${form.balloonColor === c ? "chosen" : ""}`} aria-label={c} />)}</div><label><input type="checkbox" checked={form.isAnonymous} onChange={(e) => setForm({ ...form, isAnonymous: e.target.checked })} /> Stay anonymous</label><label><input type="checkbox" checked={form.visibility === "private"} onChange={(e) => setForm({ ...form, visibility: e.target.checked ? "private" : "public" })} /> Keep private (only you can see it)</label>{error ? <p role="alert">{error}</p> : null}<button disabled={sending} className="release">{sending ? "Releasing…" : "RELEASE MY CONFESSION"}</button></form></div> : null}</main>;
}
