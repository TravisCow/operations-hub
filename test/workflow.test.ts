import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { request as httpRequest } from "node:http";
import { Store } from "../src/store.js";
import { createHub } from "../src/server.js";
import { validate } from "../src/contract.js";

const key = "test-credential-at-least-24-characters";
const sample = {
  eventId: "sample-event-1",
  request: {
    title: "Repair the door",
    description: "Inspect and adjust the closer.",
    requester: "Fictional location A",
    priority: "normal",
    dueDate: "2026-11-01",
  },
};
async function fixture(
  options: {
    beforeReceive?: () => void;
    log?: (event: Record<string, unknown>) => void;
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "operations-hub-"));
  const filename = join(dir, "test.db");
  const store = new Store(filename);
  const server = createHub(store, key, options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (
    payload: unknown = sample,
    credential: string = key,
    path = "/webhooks/requests",
  ) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Integration-Key": credential,
      },
      body: JSON.stringify(payload),
    });
  const cleanup = async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { store, filename, base, post, cleanup };
}

test("valid intake, sequential and simultaneous duplicate deliveries save one record and one activity", async () => {
  const f = await fixture();
  try {
    const first = await f.post();
    assert.equal(first.status, 201);
    const result = await first.json();
    const repeat = await f.post();
    assert.equal(repeat.status, 200);
    assert.equal((await repeat.json()).entry.id, result.entry.id);
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => f.post()),
    );
    assert.ok(responses.every((r) => r.status === 200));
    assert.equal(f.store.list().length, 1);
    assert.equal(f.store.history(result.entry.id).length, 1);
  } finally {
    await f.cleanup();
  }
});
test("a changed payload under the same event ID conflicts without changing the original", async () => {
  const f = await fixture();
  try {
    await f.post();
    const response = await f.post({
      ...sample,
      request: { ...sample.request, title: "Different work" },
    });
    assert.equal(response.status, 409);
    assert.equal(f.store.list()[0].title, sample.request.title);
  } finally {
    await f.cleanup();
  }
});
test("missing and incorrect credentials cannot create records", async () => {
  const f = await fixture();
  try {
    for (const credential of ["", "incorrect"])
      assert.equal((await f.post(sample, credential)).status, 401);
    assert.equal(f.store.list().length, 0);
  } finally {
    await f.cleanup();
  }
});
test("invalid and unknown fields fail without records", async () => {
  const f = await fixture();
  try {
    for (const value of [
      null,
      {},
      { ...sample, eventId: "bad id" },
      { ...sample, secret: "unexpected" },
      { ...sample, request: { ...sample.request, dueDate: "2026-02-30" } },
      { ...sample, request: { ...sample.request, priority: "critical" } },
      { ...sample, request: { ...sample.request, priority: ["normal"] } },
      { ...sample, request: { ...sample.request, title: " " } },
    ])
      assert.equal((await f.post(value)).status, 422);
    assert.equal(f.store.list().length, 0);
  } finally {
    await f.cleanup();
  }
});
test("temporary storage failure is retryable and the same event can later succeed once", async () => {
  let unavailable = true;
  const f = await fixture({
    beforeReceive: () => {
      if (unavailable) throw new Error("simulated unavailable storage");
    },
  });
  try {
    const failure = await f.post();
    assert.equal(failure.status, 503);
    assert.equal(failure.headers.get("retry-after"), "2");
    assert.equal((await failure.json()).retryable, true);
    assert.equal(f.store.list().length, 0);
    unavailable = false;
    assert.equal((await f.post()).status, 201);
    assert.equal((await f.post()).status, 200);
    assert.equal(f.store.list().length, 1);
  } finally {
    await f.cleanup();
  }
});
test("restart persistence uses the same SQLite file and retains duplicate handling", async () => {
  const dir = mkdtempSync(join(tmpdir(), "operations-restart-")),
    filename = join(dir, "state.db");
  try {
    let store = new Store(filename);
    const saved = store.receive(validate(sample), "reference-1");
    store.close();
    store = new Store(filename);
    try {
      assert.equal(store.get(saved.entry.id).title, sample.request.title);
      assert.equal(
        store.receive(validate(sample), "reference-2").duplicate,
        true,
      );
      assert.equal(store.history(saved.entry.id).length, 1);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("operator assignment, progression, closure, immutable closed records, and optimistic concurrency", async () => {
  const f = await fixture();
  try {
    const { entry } = await (await f.post()).json();
    const update = (owner: string, status: string, version: number) =>
      fetch(`${f.base}/api/requests/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, status, version }),
      });
    assert.equal((await update("", "assigned", 1)).status, 422);
    assert.equal((await update("Alex", "closed", 1)).status, 422);
    assert.equal((await update("Alex", "assigned", 1)).status, 200);
    assert.equal((await update("Jordan", "assigned", 1)).status, 409);
    assert.equal((await update("Alex", "in_progress", 2)).status, 200);
    assert.equal((await update("Alex", "closed", 3)).status, 200);
    assert.equal((await update("Jordan", "closed", 4)).status, 409);
    assert.equal(f.store.history(entry.id).length, 4);
  } finally {
    await f.cleanup();
  }
});
test("the sample adapter performs authenticated HTTP delivery while keeping the credential off the client", async () => {
  const logs: Record<string, unknown>[] = [];
  const f = await fixture({ log: (event) => logs.push(event) });
  try {
    const response = await f.post(sample, "", "/api/sample-requests");
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.correlationId, response.headers.get("x-correlation-id"));
    assert.equal(f.store.list().length, 1);
    assert.equal(logs.length, 2);
    const serialized = JSON.stringify(logs);
    assert.ok(!serialized.includes(key));
    assert.ok(!serialized.includes(sample.request.description));
  } finally {
    await f.cleanup();
  }
});
test("host and origin checks reject cross-site writes", async () => {
  const f = await fixture();
  try {
    const response = await fetch(f.base + "/api/sample-requests", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.com",
      },
      body: JSON.stringify(sample),
    });
    assert.equal(response.status, 403);
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        f.base + "/api/sample-requests",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Host: "example.com" },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      request.once("error", reject);
      request.end(JSON.stringify(sample));
    });
    assert.equal(status, 403);
    assert.equal(f.store.list().length, 0);
  } finally {
    await f.cleanup();
  }
});
test("a failed activity insert rolls back the request as well", () => {
  const store = new Store(":memory:");
  try {
    store.db.exec(
      "CREATE TRIGGER fail_activity BEFORE INSERT ON activity BEGIN SELECT RAISE(ABORT,'simulated failure'); END",
    );
    assert.throws(() => store.receive(validate(sample), "reference"));
    assert.equal(store.list().length, 0);
    store.db.exec("DROP TRIGGER fail_activity");
    assert.equal(store.receive(validate(sample), "reference").duplicate, false);
  } finally {
    store.close();
  }
});
test("malformed JSON and unsupported content types are rejected", async () => {
  const f = await fixture();
  try {
    const malformed = await fetch(f.base + "/webhooks/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Integration-Key": key },
      body: "{broken",
    });
    assert.equal(malformed.status, 400);
    const wrongType = await fetch(f.base + "/webhooks/requests", {
      method: "POST",
      headers: { "Content-Type": "text/plain", "X-Integration-Key": key },
      body: JSON.stringify(sample),
    });
    assert.equal(wrongType.status, 415);
    assert.equal(f.store.list().length, 0);
  } finally {
    await f.cleanup();
  }
});
test("independent SQLite connections cannot create duplicate events", async () => {
  const dir = mkdtempSync(join(tmpdir(), "operations-concurrent-")),
    filename = join(dir, "state.db");
  const store = new Store(filename);
  try {
    const entryUrl = new URL("../src/store.js", import.meta.url).href;
    const workers = Array.from(
      { length: 4 },
      () =>
        new Worker(
          `const {parentPort,workerData}=require('node:worker_threads');(async()=>{const {Store}=await import(workerData.url);const s=new Store(workerData.filename);try{parentPort.postMessage(s.receive(workerData.input,'worker').duplicate)}finally{s.close()}})().catch(e=>{throw e})`,
          {
            eval: true,
            workerData: { url: entryUrl, filename, input: validate(sample) },
          },
        ),
    );
    const results = await Promise.all(
      workers.map(
        (worker) =>
          new Promise<boolean>((resolve, reject) => {
            worker.once("message", resolve);
            worker.once("error", reject);
          }),
      ),
    );
    assert.equal(results.filter((r) => !r).length, 1);
    assert.equal(store.list().length, 1);
    assert.equal(store.history(store.list()[0].id).length, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
