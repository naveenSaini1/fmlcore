const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { transformSync } = require('next/dist/build/swc');

async function compile(path) {
  return (await transformSync(fs.readFileSync(path, 'utf8'), {
    jsc: { parser: { syntax: 'ecmascript', jsx: true } }, module: { type: 'commonjs' },
  })).code;
}
const codes = Promise.all(['lib/session-store.js', 'lib/api.js', 'lib/session.js', 'lib/request-cache.js', 'lib/chatApi.js', 'lib/live-updates.js'].map(compile));

async function fixture({ server = false } = {}) {
  const [storeCode, apiCode, providerCode, cacheCode, chatCode, liveCode] = await codes;
  const storeExports = {};
  new Function('exports', storeCode)(storeExports);
  const requests = [];
  const replies = [];
  const events = new Map();
  const storageWrites = [];
  const window = server ? undefined : {
    localStorage: { setItem: (...args) => storageWrites.push(args) },
    addEventListener: (event, handler) => events.set(event, handler),
    removeEventListener: (event) => events.delete(event),
  };
  const fetch = async (url, options) => {
    requests.push({ url, options });
    assert.ok(replies.length, `Unexpected request: ${url}`);
    return await replies.shift()();
  };
  const cacheExports = {};
  new Function('exports', cacheCode)(cacheExports);
  const api = {};
  new Function('require', 'exports', 'window', 'fetch', 'FormData', 'process', apiCode)(
    (name) => name === './session-store' ? storeExports : name === './request-cache' ? cacheExports : { waitForLiveReady: async () => {} }, api, window, fetch, FormData, process);
  const chat = {};
  new Function('require', 'exports', chatCode)(() => api, chat);
  const wsEvents = {};
  // Event strings are the public wire contract and remain readable in tests.
  for (const name of ['CONNECTION_READY', 'NOTIFICATION_CHANGED', 'CHAT_UNREAD_COUNT', 'CHAT_IDENTITY_CHANGED', 'CHAT_MESSAGE', 'CHAT_MESSAGE_SENT', 'CHAT_MESSAGE_READ', 'CHAT_MESSAGE_DELIVERED', 'SAME_SKY_CONNECTION_CREATED', 'SAME_SKY_MATCH_ACCEPTED']) wsEvents[name] = name;
  const live = {};
  new Function('require', 'exports', liveCode)(() => ({ WS_EVENTS: wsEvents }), live);
  return {
    api, chat, live, wsEvents, store: storeExports.sessionStore, requests, storageWrites, events,
    reply(data, status = 200) { replies.push(async () => new Response(JSON.stringify(data), { status })); },
    defer() {
      let resolve;
      replies.push(() => new Promise(done => { resolve = done; }));
      return (data, status = 200) => resolve(new Response(JSON.stringify(data), { status }));
    },
    mountProvider() {
      const exports = {};
      const react = { useEffect: (effect) => effect(), useSyncExternalStore: () => storeExports.sessionStore.getSnapshot() };
      new Function('require', 'exports', 'window', providerCode)((name) => name === 'react' ? react : name === './api' ? api : storeExports, exports, window);
      exports.SessionProvider({ children: null });
    },
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('concurrent checks and later navigation share one request and snapshot', async () => {
  const f = await fixture(); const finish = f.defer();
  const checks = Array.from({ length: 10 }, () => f.api.getMe());
  await tick(); assert.equal(f.requests.length, 1);
  finish({ id: 'user-a', username: 'Alice' });
  assert.ok((await Promise.all(checks)).every(user => user.id === 'user-a'));
  for (let page = 0; page < 8; page++) assert.equal((await f.api.getMe()).id, 'user-a');
  assert.equal(f.requests.length, 1);
});

test('guest sessions cache 401 and do not retry on every page', async () => {
  const f = await fixture(); f.reply({ detail: 'Log in again.' }, 401);
  assert.equal(await f.api.getMe(), null);
  assert.equal(await f.api.getMe(), null);
  assert.equal(f.requests.length, 1);
});

test('logout wins over a pending session response', async () => {
  const f = await fixture(); const finish = f.defer();
  const pending = f.api.getMe(); await tick();
  f.reply({ ok: true }); await f.api.logout();
  finish({ id: 'old-user' });
  assert.equal(await pending, null);
  assert.equal(f.store.getSnapshot().user, null);
});

test('verification flows keep the existing session; successful auth seeds it', async () => {
  const f = await fixture(); f.store.setUser(null);
  f.reply({ requires_verification: true, challenge_id: 'challenge' });
  await f.api.login({}); assert.equal(f.store.getSnapshot().user, null);
  f.reply({ id: 'new-user', username: 'New' }); await f.api.verifyEmail({});
  assert.equal((await f.api.getMe()).id, 'new-user');
  assert.equal(f.requests.length, 2);
});

test('profile and appearance responses update all subscribers without a session GET', async () => {
  const f = await fixture(); let changes = 0;
  f.store.subscribe(() => changes++); f.store.setUser({ id: 'user' });
  f.reply({ id: 'user', username: 'Updated' }); await f.api.updateProfile({});
  f.reply({ id: 'user', username: 'Updated', theme: 'midnight' }); await f.api.updateTheme('midnight');
  f.reply({ id: 'user', username: 'Updated', theme: 'midnight', skin: 'common-ground' }); await f.api.updateSkin('common-ground');
  assert.equal((await f.api.getMe()).username, 'Updated');
  assert.equal(changes, 4);
  assert.ok(f.requests.every(request => !request.url.endsWith('/auth/me')));
});

test('session expiry clears shared state; an old 401 cannot clear a newer login', async () => {
  const f = await fixture(); f.store.setUser({ id: 'old' });
  const finish = f.defer(); const stale = f.api.api('/notifications'); await tick();
  f.reply({ id: 'new' }); await f.api.login({});
  finish({ detail: 'Expired' }, 401); await assert.rejects(stale);
  assert.equal(f.store.getSnapshot().user.id, 'new');
  f.reply({ detail: 'Expired' }, 401); await assert.rejects(f.api.api('/notifications'));
  assert.equal(f.store.getSnapshot().user, null);
});

test('cross-tab changes refresh once while legacy local events reuse the cache', async () => {
  const f = await fixture(); f.reply({ id: 'first' }); f.mountProvider(); await tick();
  f.events.get('fmlcore:auth-change')(); f.events.get('fmlcore:profile-change')(); await tick();
  assert.equal(f.requests.length, 1);
  f.reply({ id: 'second' }); f.events.get('storage')({ key: 'fmlcore-session-change' }); await tick();
  assert.equal(f.requests.length, 2); assert.equal(f.store.getSnapshot().user.id, 'second');
});

test('server-side callers never reuse another visitors session', async () => {
  const f = await fixture({ server: true });
  f.reply({ id: 'visitor-a' }); f.reply({ id: 'visitor-b' });
  assert.equal((await f.api.getMe()).id, 'visitor-a');
  assert.equal((await f.api.getMe()).id, 'visitor-b');
  assert.equal(f.requests.length, 2);
});

test('Same Sky shares concurrent loads and quick remounts, while explicit refreshes stay fresh', async () => {
  const f = await fixture(); f.store.setUser({ id: 'sky-user' });
  const finish = f.defer();
  const requests = Array.from({ length: 4 }, () => f.api.getSameSky());
  await tick(); assert.equal(f.requests.length, 1);
  finish({ version: 1 });
  assert.ok((await Promise.all(requests)).every(result => result.version === 1));
  assert.equal((await f.api.getSameSky()).version, 1);
  assert.equal(f.requests.length, 1);
  f.reply({ version: 2 });
  assert.equal((await f.api.getSameSky({ fresh: true })).version, 2);
  assert.equal(f.requests.length, 2);
});

test('a matching action invalidates cached and pending Same Sky responses', async () => {
  const f = await fixture(); f.store.setUser({ id: 'sky-user' });
  const finishOld = f.defer(); const old = f.api.getSameSky(); await tick();
  f.reply({ id: 'attempt', status: 'queued' }); await f.api.startSameSkyAttempt();
  const finishNew = f.defer(); const fresh = f.api.getSameSky(); await tick();
  finishOld({ version: 'before-action' }); await tick();
  finishNew({ version: 'after-action' });
  assert.equal((await old).version, 'after-action');
  assert.equal((await fresh).version, 'after-action');
  assert.equal(f.requests.filter(request => request.url.endsWith('/same-sky')).length, 2);
});

test('failed Same Sky requests can retry and cached results cannot cross accounts', async () => {
  const f = await fixture(); f.store.setUser({ id: 'first' });
  f.reply({ detail: 'Try again' }, 503); await assert.rejects(f.api.getSameSky());
  f.reply({ owner: 'first' }); assert.equal((await f.api.getSameSky()).owner, 'first');
  f.store.setUser({ id: 'second' });
  f.reply({ owner: 'second' }); assert.equal((await f.api.getSameSky()).owner, 'second');
  const finishOld = f.defer(); const stale = f.api.getSameSky({ fresh: true }); await tick();
  f.store.setUser({ id: 'third' }); finishOld({ owner: 'second' });
  await assert.rejects(stale, { name: 'AbortError' });
});

test('a completed attempt refreshes the profile even inside the remount cache window', async () => {
  const f = await fixture(); f.store.setUser({ id: 'sky-user' });
  f.reply({ status: 'searching' }); await f.api.getSameSky();
  f.reply({ status: 'match_found' }); await f.api.getSameSkyAttempt('attempt');
  f.reply({ status: 'match_found' });
  assert.equal((await f.api.getSameSky()).status, 'match_found');
  assert.equal(f.requests.length, 3);
});

test('four identical leaderboard loads share one request, including a quick widget-to-page visit', async () => {
  const f = await fixture(); f.store.setUser({ id: 'viewer' });
  const finish = f.defer();
  const loads = Array.from({ length: 4 }, () => f.api.getLeaderboard({ limit: 5, offset: 0 }));
  await tick(); assert.equal(f.requests.length, 1);
  finish({ entries: [{ rank: 1 }], next_offset: 5 });
  assert.ok((await Promise.all(loads)).every(data => data.next_offset === 5));
  assert.equal((await f.api.getLeaderboard()).entries[0].rank, 1);
  assert.equal(f.requests.length, 1);
});

test('leaderboard limit and offset identify separate pages', async () => {
  const f = await fixture(); f.store.setUser({ id: 'viewer' });
  f.reply({ entries: [1], next_offset: 5 });
  f.reply({ entries: [2], next_offset: 10 });
  f.reply({ entries: [3], next_offset: null });
  const pages = await Promise.all([
    f.api.getLeaderboard({ limit: 5, offset: 0 }),
    f.api.getLeaderboard({ limit: 5, offset: 5 }),
    f.api.getLeaderboard({ limit: 10, offset: 0 }),
  ]);
  assert.deepEqual(pages.map(page => page.entries[0]), [1, 2, 3]);
  assert.deepEqual(f.requests.map(request => request.url), [
    '/api/leaderboard?limit=5&offset=0', '/api/leaderboard?limit=5&offset=5', '/api/leaderboard?limit=10&offset=0',
  ]);
});

test('reactions invalidate pending leaderboard responses and callers join the updated result', async () => {
  const f = await fixture(); f.store.setUser({ id: 'viewer' });
  const finishOld = f.defer(); const old = f.api.getLeaderboard(); await tick();
  f.reply({ ok: true }); await f.api.setReaction('post', 'relatable');
  const finishNew = f.defer(); const fresh = f.api.getLeaderboard(); await tick();
  finishOld({ votes: 1 }); await tick(); finishNew({ votes: 2 });
  assert.equal((await old).votes, 2); assert.equal((await fresh).votes, 2);
  assert.equal(f.requests.filter(request => request.url.includes('/leaderboard?')).length, 2);
});

test('leaderboard failures retry, viewer changes do not reuse data, and cached pages expire', async () => {
  const f = await fixture(); f.store.setUser({ id: 'first' });
  f.reply({ detail: 'Unavailable' }, 503); await assert.rejects(f.api.getLeaderboard());
  f.reply({ viewer: 'first' }); assert.equal((await f.api.getLeaderboard()).viewer, 'first');
  f.store.setUser({ id: 'second' });
  f.reply({ viewer: 'second' }); assert.equal((await f.api.getLeaderboard()).viewer, 'second');
  await new Promise(resolve => setTimeout(resolve, 1050));
  f.reply({ viewer: 'second', refreshed: true }); assert.equal((await f.api.getLeaderboard()).refreshed, true);
  const finishOld = f.defer(); const oldPage = f.api.getLeaderboard({ offset: 5 }); await tick();
  f.store.setUser({ id: 'third' }); finishOld({ viewer: 'second' });
  await assert.rejects(oldPage, { name: 'AbortError' });
});

test('four confession first-page loads and quick remounts share one request', async () => {
  const f = await fixture(); f.store.setUser({ id: 'viewer' });
  const finish = f.defer(); const loads = Array.from({ length: 4 }, () => f.api.getConfessions());
  await tick(); assert.equal(f.requests.length, 1);
  finish({ posts: [{ id: 'balloon' }], next_cursor: 'next' });
  assert.ok((await Promise.all(loads)).every(page => page.posts[0].id === 'balloon'));
  assert.equal((await f.api.getConfessions()).next_cursor, 'next');
  assert.equal(f.requests.length, 1);
});

test('confession cursors identify separate pages and duplicate cursor requests are combined', async () => {
  const f = await fixture(); f.store.setUser({ id: 'viewer' });
  f.reply({ posts: [1], next_cursor: 'date|id' });
  const finish = f.defer();
  const first = f.api.getConfessions();
  const next = f.api.getConfessions('date|id');
  const sameNext = f.api.getConfessions('date|id');
  await tick(); assert.equal(f.requests.length, 2);
  finish({ posts: [2], next_cursor: null });
  assert.deepEqual((await first).posts, [1]);
  assert.deepEqual((await next).posts, [2]);
  assert.deepEqual((await sameNext).posts, [2]);
  assert.equal(f.requests[1].url, '/api/confessions?limit=30&cursor=date%7Cid');
});

test('creating a confession invalidates pending lists and returns the new version to their callers', async () => {
  const f = await fixture(); f.store.setUser({ id: 'viewer' });
  const finishOld = f.defer(); const old = f.api.getConfessions(); await tick();
  f.reply({ id: 'new-balloon' });
  await f.api.createConfession({ body: 'test', category: 'Confessions', mood: 'soft', isAnonymous: true, visibility: 'public', balloonColor: 'pink' });
  const finishNew = f.defer(); const updated = f.api.getConfessions(); await tick();
  finishOld({ posts: [] }); await tick(); finishNew({ posts: [{ id: 'new-balloon' }] });
  assert.equal((await old).posts[0].id, 'new-balloon');
  assert.equal((await updated).posts[0].id, 'new-balloon');
  assert.equal(f.requests.filter(request => request.url.includes('/confessions?')).length, 2);
});

test('confession failures retry and viewer changes discard old private state', async () => {
  const f = await fixture(); f.store.setUser({ id: 'first' });
  f.reply({ detail: 'Try again' }, 503); await assert.rejects(f.api.getConfessions());
  f.reply({ posts: ['first'] }); assert.deepEqual((await f.api.getConfessions()).posts, ['first']);
  f.store.setUser({ id: 'second' });
  f.reply({ posts: ['second'] }); assert.deepEqual((await f.api.getConfessions()).posts, ['second']);
  const finish = f.defer(); const old = f.api.getConfessions('next'); await tick();
  f.store.setUser(null); finish({ posts: ['second'] });
  await assert.rejects(old, { name: 'AbortError' });
});

test('shared API combines chat, notifications, and arbitrary deterministic reads', async () => {
  const f = await fixture(); f.store.setUser({ id: 'viewer' });
  for (const load of [() => f.chat.getConversations(), () => f.api.getNotifications(), () => f.api.getFeed()]) {
    const before = f.requests.length; const finish = f.defer();
    const calls = Array.from({ length: 4 }, load);
    await tick(); assert.equal(f.requests.length, before + 1);
    finish({ snapshot: 'current' });
    assert.ok((await Promise.all(calls)).every(data => data.snapshot === 'current'));
    await load(); assert.equal(f.requests.length, before + 1);
  }
});

test('canonical query order shares reads while filters, cursors and request headers remain distinct', async () => {
  const f = await fixture(); f.store.setUser({ id: 'viewer' });
  const finish = f.defer();
  const a = f.api.api('/posts?category=Work&limit=5');
  const b = f.api.api('/posts?limit=5&category=Work');
  await tick(); assert.equal(f.requests.length, 1); finish({ posts: [] }); await Promise.all([a,b]);
  f.reply({ posts: [1] }); await f.api.api('/posts?category=Family&limit=5');
  f.reply({ posts: [2] }); await f.api.api('/posts?category=Work&limit=5', { headers: { 'Accept-Language': 'hi' } });
  assert.equal(f.requests.length, 3);
});

test('mutation calls and intentional random actions are never combined', async () => {
  const f = await fixture(); f.store.setUser({ id: 'viewer' });
  f.reply({ ok: true }); f.reply({ ok: true });
  await Promise.all([f.api.api('/notifications/read-all', { method: 'POST' }), f.api.api('/notifications/read-all', { method: 'POST' })]);
  f.reply({ id: 'random-a' }); f.reply({ id: 'random-b' });
  const random = await Promise.all([f.api.getRandomConfession(), f.api.getRandomConfession()]);
  assert.deepEqual(random.map(post => post.id), ['random-a', 'random-b']);
  assert.equal(f.requests.length, 4);
});

test('one aborted read cannot cancel a different consumers request', async () => {
  const f = await fixture(); f.store.setUser({ id: 'viewer' });
  f.reply({ posts: ['independent'] }); f.reply({ posts: ['shared'] });
  const controller = new AbortController();
  await Promise.all([f.api.api('/posts', { signal: controller.signal }), f.api.api('/posts')]);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].options.signal, controller.signal);
});

test('profile edits do not make in-flight reads look like a different account', async () => {
  const f = await fixture(); f.store.setUser({ id: 'viewer', username: 'Before' });
  const finish = f.defer(); const read = f.api.getNotifications(); await tick();
  f.reply({ id: 'viewer', username: 'After' }); await f.api.updateProfile({ username: 'After' });
  finish({ notifications: [] }); assert.deepEqual((await read).notifications, []);
});

test('notification mutation invalidates the inbox and unread count together', async () => {
  const f = await fixture(); f.store.setUser({ id: 'viewer' });
  f.reply({ notifications: [{ id: 'n', is_read: false }] }); await f.api.getNotifications();
  f.reply({ count: 1 }); await f.api.getUnreadCount();
  f.reply({ ok: true }); await f.api.markAllNotificationsRead();
  f.reply({ notifications: [{ id: 'n', is_read: true }] }); f.reply({ count: 0 });
  const [inbox, badge] = await Promise.all([f.api.getNotifications(), f.api.getUnreadCount()]);
  assert.equal(inbox.notifications[0].is_read, true); assert.equal(badge.count, 0);
});

test('live events invalidate snapshots before refresh; reconnect refreshes once for multiple listeners', async () => {
  const f = await fixture(); f.store.setUser({ id: 'viewer' });
  const handlers = new Map();
  const client = { on(event, callback) { handlers.set(event, callback); return () => handlers.delete(event); } };
  const reads = []; let ready = false;
  const stop = f.live.attachLiveUpdates(client, {
    invalidate: f.api.invalidateApiReads,
    setReady: value => { ready = value; }, setUnread: () => {},
    notify: name => {
      if (name === 'fmlcore:chat-sync') reads.push(f.chat.getConversations(), f.chat.getConversations());
      if (name === 'fmlcore:notifications-change') reads.push(f.api.getNotifications(), f.api.getNotifications());
    },
  });
  for (let connection = 0; connection < 2; connection++) {
    f.reply({ notifications: [connection] }); f.reply([{ id: 'conversation', connection }]);
    handlers.get(f.wsEvents.CONNECTION_READY)();
    await Promise.all(reads.splice(0)); assert.equal(ready, true);
    assert.equal(f.requests.length, 2 * (connection + 1));
  }
  f.reply({ notifications: ['new-notification'] });
  handlers.get(f.wsEvents.NOTIFICATION_CHANGED)(); await Promise.all(reads.splice(0));
  assert.equal(f.requests.length, 5);
  stop(); assert.equal(handlers.size, 0);
});

test('a socket refresh during a notification write waits and shares the post-write snapshot', async () => {
  const f = await fixture(); f.store.setUser({ id: 'viewer' });
  const finishWrite = f.defer(); const writing = f.api.markAllNotificationsRead(); await tick();
  f.api.invalidateApiReads(['notifications']);
  const early = [f.api.getNotifications(), f.api.getUnreadCount()];
  await tick(); assert.equal(f.requests.length, 1, 'Live readers must wait for the active write');
  f.reply({ notifications: [{ id: 'n', is_read: true }] }); f.reply({ count: 0 });
  finishWrite({ ok: true }); await writing;
  const final = [f.api.getNotifications(), f.api.getUnreadCount()];
  const results = await Promise.all([...early, ...final]);
  assert.equal(results[0].notifications[0].is_read, true);
  assert.equal(results[1].count, 0);
  assert.equal(f.requests.filter(request => request.url === '/api/notifications').length, 1);
  assert.equal(f.requests.filter(request => request.url === '/api/notifications/unread-count').length, 1);
});


test('profile sharing events replace cached identity in chat history, detail and matches', async () => {
  const f = await fixture(); f.store.setUser({ id: 'viewer' });
  const handlers = new Map();
  const client = { on(name, handler) { handlers.set(name, handler); return () => handlers.delete(name); } };
  const stop = f.live.attachLiveUpdates(client, {
    invalidate: f.api.invalidateApiReads, notify() {}, setReady() {}, setUnread() {},
  });
  const read = () => Promise.all([f.chat.getConversation('c'), f.chat.getMessages('c'), f.api.getSameSky()]);
  for (const revealed of [true, false]) {
    for (let i = 0; i < 3; i++) f.reply({ revealed });
    assert.ok((await read()).every(data => data.revealed === revealed));
    handlers.get(f.wsEvents.CHAT_IDENTITY_CHANGED)({ conversation_id: 'c' });
  }
  assert.equal(f.requests.length, 6);
  stop();
});
