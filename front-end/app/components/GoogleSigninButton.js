"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { googleSignin, startGoogleSignin } from "../../lib/api";

export default function GoogleSigninButton({ onResult, onError, disabled }) {
  const container = useRef(null);
  const callbacks = useRef({ onResult, onError });
  callbacks.current = { onResult, onError };
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!loaded || !window.google?.accounts?.id) return;
    let alive = true;
    setFailed(false);
    startGoogleSignin().then(flow => {
      if (!alive || !container.current) return;
      window.google.accounts.id.initialize({ client_id: flow.client_id, nonce: flow.nonce, auto_select: false,
        callback: async result => {
          if (!alive) return;
          try { const response = await googleSignin({ credential: result.credential, challenge_id: flow.challenge_id }); if (alive) callbacks.current.onResult(response); }
          catch (error) { if (alive) { callbacks.current.onError(error.message); setFailed(true); } }
        },
      });
      container.current.replaceChildren();
      window.google.accounts.id.renderButton(container.current, { type: "standard", theme: "outline", size: "large", text: "continue_with", width: Math.min(360, Math.floor(container.current.clientWidth)) });
    }).catch(error => { if (alive) { callbacks.current.onError(error.message); setFailed(true); } });
    return () => { alive = false; };
  }, [loaded, retry]);
  return <div className="auth-google" aria-busy={!loaded} style={disabled ? { pointerEvents: "none", opacity: .5 } : undefined}>
    <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onReady={() => setLoaded(true)} onError={() => { setFailed(true); callbacks.current.onError("Google sign-in couldn't load. Please try again."); }} />
    <div ref={container} className="min-h-11" />
    {!loaded && !failed && <p className="text-xs text-ink/70">Loading Google sign-in…</p>}
    {failed && <button type="button" className="text-sm underline" onClick={() => { if (!loaded) window.location.reload(); else setRetry(value => value + 1); }}>Try Google again</button>}
  </div>;
}
