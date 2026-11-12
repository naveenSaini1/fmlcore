import test from "node:test";
import assert from "node:assert/strict";
import { readApiResponse } from "../app/lib/api-response.mjs";

test("returns successful JSON and preserves API error details", async () => {
  assert.deepEqual(await readApiResponse(new Response('{"ok":true}')), { ok: true });
  await assert.rejects(readApiResponse(new Response('{"detail":"This account does not have admin access."}', { status: 403 })), /does not have admin access/);
});

test("plain-text backend crashes and HTML proxy failures get readable errors", async () => {
  for (const [status, body] of [[500, "Internal Server Error"], [502, "<html>Bad Gateway</html>"]]) {
    await assert.rejects(readApiResponse(new Response(body, { status })), /server could not complete/);
  }
});
