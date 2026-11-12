export function pushSupported() {
  return typeof window !== "undefined" && window.isSecureContext && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}
export function applicationServerKey(value) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
export async function currentPushSubscription() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration ? registration.pushManager.getSubscription() : null;
}
export async function removeBrowserPush(api) {
  const subscription = await currentPushSubscription();
  if (!subscription) return;
  try {
    await api("/browser-push/subscriptions", {
      method: "DELETE",
      body: JSON.stringify({ endpoint: subscription.endpoint }),
      signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(4000) : undefined,
    });
  } finally {
    await subscription.unsubscribe();
  }
}
