"use client";

import { useEffect } from "react";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { applicationServerKey, pushSupported } from "../../lib/browser-push";

const promptedKey = "fmlcore:native-notification-prompt";
let promptedInPage = false;

export default function BrowserNotifications() {
  const { user } = useSession();

  useEffect(() => {
    if (!user?.id || !pushSupported() || Notification.permission === "denied") return;

    let active = true;
    let onClick;
    try {
      if (localStorage.getItem(`fmlcore:notification-prompt:${user.id}`) === "off") return;
    } catch {}

    async function subscribe(publicKey) {
      if (!active) return;
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      if (!active) return;

      const existing = await registration.pushManager.getSubscription();
      if (!active) return;
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(publicKey),
      });

      try {
        if (!active) {
          if (!existing) await subscription.unsubscribe();
          return;
        }
        await api("/browser-push/subscriptions", {
          method: "POST",
          body: JSON.stringify(subscription.toJSON()),
        });
      } catch (error) {
        if (!existing) await subscription.unsubscribe();
        throw error;
      }
    }

    api("/browser-push/config").then(config => {
      if (!active || !config.enabled) return;
      if (Notification.permission === "granted") return subscribe(config.public_key);
      if (Notification.permission !== "default" || promptedInPage) return;
      try {
        if (sessionStorage.getItem(promptedKey)) return;
      } catch {}

      onClick = event => {
        if (!event.isTrusted || event.defaultPrevented) return;
        document.removeEventListener("click", onClick, true);
        if (Notification.permission !== "default") return;
        promptedInPage = true;
        try { sessionStorage.setItem(promptedKey, "yes"); } catch {}
        // Invoke synchronously inside the trusted click to keep browser activation.
        Notification.requestPermission().then(permission => {
          if (permission === "granted") return subscribe(config.public_key);
        }).catch(() => {});
      };
      document.addEventListener("click", onClick, true);
    }).catch(() => {});

    return () => {
      active = false;
      if (onClick) document.removeEventListener("click", onClick, true);
    };
  }, [user?.id]);

  return null;
}
