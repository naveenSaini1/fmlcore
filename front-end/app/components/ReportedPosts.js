"use client";

import { useEffect, useState } from "react";
import { getMyReportedPosts } from "../../lib/api";

export default function ReportedPosts() {
  const [reports, setReports] = useState([]);
  useEffect(() => { getMyReportedPosts().then((data) => setReports(data.reports)).catch(() => setReports([])); }, []);
  return <section className="md:col-span-2 border-4 border-ink bg-white p-5 shadow-[6px_6px_0_var(--color-shadow)]">
    <h2 className="font-display text-2xl font-extrabold">Posts you reported</h2>
    {!reports.length ? <p className="mt-2 font-semibold">No reported posts yet.</p> : <ul className="mt-3 space-y-3">{reports.map((item) => <li key={item.id} className="border-2 border-ink bg-paper p-3"><p className="whitespace-pre-wrap font-semibold">{item.post.body}</p><p className="mt-2 text-xs font-bold">{item.post.category} · Report status: {item.status}</p></li>)}</ul>}
  </section>;
}
