// Give the initial socket handshake a short chance to finish before loading
// chat/inbox snapshots. HTTP still works when the socket is unavailable.
let ready = false;
const waiting = new Set();
export function setLiveReady(value) {
  ready = value;
  if (ready) [...waiting].forEach((finish) => finish());
}
export function waitForLiveReady() {
  if (ready) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); waiting.delete(finish); resolve(); };
    const timer = setTimeout(finish, 300);
    waiting.add(finish);
  });
}
