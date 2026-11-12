"use client";

import { useEffect, useId, useState } from "react";
import { checkUsername } from "../../lib/api";
import Field, { inputClass } from "./Field";

export default function UsernameField() {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState("");
  const hint = useId();
  useEffect(() => {
    let alive = true;
    if (!value) { setStatus(""); return; }
    if (!/^[A-Za-z0-9_]{3,20}$/.test(value)) { setStatus("Use 3–20 letters, numbers, or underscores."); return; }
    setStatus("Checking availability…");
    const timer = setTimeout(() => {
      checkUsername(value).then(result => { if (alive) setStatus(result.available ? "Username available" : "That username is taken."); })
        .catch(() => { if (alive) setStatus("We'll check availability when you continue."); });
    }, 350);
    return () => { alive = false; clearTimeout(timer); };
  }, [value]);
  return <div>
    <Field label="Username" note="3–20 letters, numbers, underscores">
      <input className={inputClass} name="username" autoComplete="username" value={value} onChange={event => setValue(event.target.value)} pattern="[A-Za-z0-9_]{3,20}" minLength={3} maxLength={20} aria-describedby={hint} required />
    </Field>
    <p id={hint} role="status" className="mt-1 text-xs text-ink/70">{status}</p>
  </div>;
}
