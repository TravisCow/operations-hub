import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { Store } from "./store.js";
import { createHub } from "./server.js";

const database = resolve(process.env.HUB_DATABASE || "data/operations.db");
mkdirSync(dirname(database), { recursive: true });
const store = new Store(database);
const key = process.env.HUB_INTEGRATION_KEY || randomBytes(32).toString("hex");
const server = createHub(store, key, {
  log: (event) => console.log(JSON.stringify(event)),
});
server.listen(Number(process.env.PORT || 5100), "127.0.0.1", () => {
  console.log(
    `Operations Hub: http://localhost:${(server.address() as { port: number }).port}`,
  );
  console.log(
    "Local prototype. Sample form enabled; integration credential stays on the server.",
  );
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () =>
    server.close(() => {
      store.close();
      process.exit();
    }),
  );
