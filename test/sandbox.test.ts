import { test } from "node:test";
import assert from "node:assert/strict";
import { Sandbox } from "../ui/sandbox.js";

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) || null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}
const input = {
  eventId: "sandbox-event-1",
  request: {
    title: "Inspect the gate",
    description: "Fictional sample maintenance request.",
    requester: "Demo location A",
    priority: "normal",
    dueDate: "2026-11-01",
  },
};
const post = (sandbox: Sandbox, data: unknown = input) =>
  sandbox.call("/api/sample-requests", {
    method: "POST",
    body: JSON.stringify(data),
  });
test("sandbox storage is isolated per tab and retained on reload", async () => {
  const storage = memory(),
    first = new Sandbox(storage),
    other = new Sandbox(memory());
  await post(first);
  assert.equal((await first.call("/api/requests")).requests.length, 4);
  assert.equal((await other.call("/api/requests")).requests.length, 3);
  assert.equal(
    (await new Sandbox(storage).call("/api/requests")).requests.length,
    4,
  );
});
test("repeat and simultaneous sandbox deliveries never add duplicate requests or activity", async () => {
  const sandbox = new Sandbox(memory()),
    saved = await post(sandbox);
  const repeats = await Promise.all(
    Array.from({ length: 10 }, () => post(sandbox)),
  );
  assert.ok(repeats.every((r) => r.duplicate && r.entry.id === saved.entry.id));
  assert.equal((await sandbox.call("/api/requests")).requests.length, 4);
  assert.equal(
    (await sandbox.call("/api/requests/" + saved.entry.id)).history.length,
    1,
  );
  await assert.rejects(
    post(sandbox, {
      ...input,
      request: { ...input.request, title: "Different contents" },
    }),
    { status: 409 },
  );
});
test("simulated failure has no saved side effect and a retry succeeds once", async () => {
  const sandbox = new Sandbox(memory());
  sandbox.failNextDelivery();
  await assert.rejects(post(sandbox), { status: 503 });
  assert.equal((await sandbox.call("/api/requests")).requests.length, 3);
  assert.equal((await post(sandbox)).duplicate, false);
  assert.equal((await post(sandbox)).duplicate, true);
});
test("sandbox respects assignment, workflow, immutable closure, and stale versions", async () => {
  const sandbox = new Sandbox(memory()),
    { entry } = await post(sandbox);
  const update = (owner: string, status: string, version: number) =>
    sandbox.call("/api/requests/" + entry.id, {
      method: "PATCH",
      body: JSON.stringify({ owner, status, version }),
    });
  await assert.rejects(update("", "assigned", 1), { status: 422 });
  await assert.rejects(update("Alex", "closed", 1), { status: 422 });
  await update("Alex", "assigned", 1);
  await assert.rejects(update("Jordan", "assigned", 1), { status: 409 });
  await update("Alex", "in_progress", 2);
  await update("Alex", "closed", 3);
  await assert.rejects(update("Jordan", "closed", 4), { status: 409 });
  assert.equal(
    (await sandbox.call("/api/requests/" + entry.id)).history.length,
    4,
  );
});
test("reset restores sample data and validation rejects malformed request fields", async () => {
  const sandbox = new Sandbox(memory());
  await post(sandbox);
  sandbox.reset();
  assert.equal((await sandbox.call("/api/requests")).requests.length, 3);
  await assert.rejects(
    post(sandbox, {
      ...input,
      request: { ...input.request, priority: ["normal"] },
    }),
    { status: 422 },
  );
});
test("unavailable storage fails clearly without a success result", async () => {
  const storage = memory();
  storage.setItem = () => {
    throw new Error("storage blocked");
  };
  await assert.rejects(post(new Sandbox(storage)), { status: 503 });
});
