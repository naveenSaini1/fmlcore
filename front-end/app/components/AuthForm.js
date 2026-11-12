"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { completeGoogleSignup, getAuthOptions, login, resendEmailCode, signup, verifyEmail } from "../../lib/api";
import Field, { inputClass } from "./Field";
import GoogleSigninButton from "./GoogleSigninButton";
import UsernameField from "./UsernameField";

export default function AuthForm({ mode }) {
  const router = useRouter();
  const creating = mode === "signup";
  const [options, setOptions] = useState(null);
  const [flow, setFlow] = useState(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [notice, setNotice] = useState("");
  useEffect(() => { let alive = true; getAuthOptions().then(value => { if (alive) setOptions(value); }).catch(() => { if (alive) setError("Sign-in options couldn't load. Please refresh."); }); return () => { alive = false; }; }, []);
  useEffect(() => {
    if (!countdown) return;
    const timer = setTimeout(() => setCountdown(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);
  function acceptResult(result) {
    setError(""); setNotice(""); setCode(""); setPending(false);
    if (result.requires_verification || result.requires_username) {
      setFlow(result); setCountdown(result.resend_after || 0); return;
    }
    window.dispatchEvent(new Event("fmlcore:auth-change"));
    router.push("/"); router.refresh();
  }
  async function submit(event) {
    event.preventDefault(); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    setPending(true);
    try {
      if (flow?.requires_verification) acceptResult(await verifyEmail({ challenge_id: flow.challenge_id, code }));
      else if (flow?.requires_username) acceptResult(await completeGoogleSignup({ challenge_id: flow.challenge_id, username: String(form.get("username") || ""), age_confirmed: form.get("age") === "on" }));
      else {
        const body = { email: String(form.get("email") || "").trim(), password: String(form.get("password") || "") };
        if (creating) {
          if (body.password !== String(form.get("confirm") || "")) throw new Error("Those passwords do not match.");
          body.username = String(form.get("username") || ""); body.age_confirmed = form.get("age") === "on";
        }
        acceptResult(await (creating ? signup(body) : login(body)));
      }
    } catch (err) { setError(err.message); setPending(false); }
  }
  async function resend() {
    setPending(true); setError(""); setNotice("");
    try { const result = await resendEmailCode(flow.challenge_id); setCountdown(result.resend_after); setCode(""); setNotice("A new code is on its way."); }
    catch (err) { setError(err.message); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit} className="auth-form min-w-0 space-y-4 border-4 border-ink bg-white p-5 shadow-[8px_8px_0_var(--color-shadow)]">
    {flow?.requires_verification ? <>
      <h2 className="font-display text-2xl font-bold">Check your email</h2>
      <p className="text-sm text-ink/70">Enter the six-digit code sent to {flow.email_hint}.</p>
      <Field label="Verification code"><input className={inputClass} name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} autoFocus required /></Field>
    </> : flow?.requires_username ? <>
      <h2 className="font-display text-2xl font-bold">One last thing.</h2>
      <p className="text-sm text-ink/70">Choose a username for {flow.email}.</p>
      <UsernameField /><AgeConfirmation />
    </> : <>
      {options?.google_enabled ? <><GoogleSigninButton onResult={acceptResult} onError={setError} disabled={pending} /><p className="text-center text-xs text-ink/60">or continue with email</p></> : options && <><button type="button" disabled className="w-full border-2 border-ink px-4 py-3 text-sm opacity-50">Continue with Google</button><p className="text-xs text-ink/60">Google sign-in is currently unavailable.</p></>}
      {options && !options.email_enabled && (creating || options.email_otp_every_login) && <p className="text-sm text-ink/70">Email verification is temporarily unavailable.</p>}
      <Field label="Email"><input className={inputClass} name="email" type="email" autoComplete="email" required /></Field>
      {creating && <UsernameField />}
      <Field label="Password" note={creating ? "At least 8 characters" : undefined}><input className={inputClass} name="password" type="password" autoComplete={creating ? "new-password" : "current-password"} minLength={creating ? 8 : undefined} maxLength={72} required /></Field>
      {creating && <><Field label="Confirm password"><input className={inputClass} name="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={72} required /></Field><AgeConfirmation /></>}
    </>}
    {error && <p className="text-sm font-semibold text-danger" role="alert">{error}</p>}
    {notice && <p className="text-sm" role="status">{notice}</p>}
    <button type="submit" disabled={pending || !options} className="w-full border-4 border-ink bg-lime px-4 py-3 font-extrabold shadow-[4px_4px_0_var(--color-shadow)] disabled:opacity-60">{pending ? "Please wait…" : flow?.requires_verification ? "Verify and continue" : flow?.requires_username ? "Create my profile" : creating ? "Create my profile" : "Log in"}</button>
    {flow?.requires_verification && <button type="button" onClick={resend} disabled={pending || countdown > 0} className="text-sm underline disabled:opacity-50">{countdown ? `Resend in ${countdown}s` : "Resend code"}</button>}
    {flow ? <button type="button" disabled={pending} onClick={() => { setFlow(null); setCode(""); setError(""); setNotice(""); }} className="ml-3 text-sm underline">Start again</button>
      : <p className="text-sm">{creating ? "Already here?" : "New here?"} <Link href={creating ? "/login" : "/signup"} className="underline">{creating ? "Log in" : "Make a profile"}</Link></p>}
  </form>;
}

function AgeConfirmation() {
  return <label className="flex items-start gap-3 border-2 border-ink bg-paper p-3 text-sm"><input name="age" type="checkbox" className="mt-1 h-5 w-5 accent-ink" required /><span>I am 18 or older.</span></label>;
}
