import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  fingerprint,
  Problem,
  type Intake,
  type Payload,
  type Status,
} from "./contract.js";

export type Entry = Payload & {
  id: string;
  eventId: string;
  owner: string;
  status: Status;
  createdAt: string;
  correlationId: string;
  version: number;
};
export type Activity = {
  id: number;
  requestId: string;
  action: string;
  at: string;
};
export class Store {
  db: DatabaseSync;
  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
        payload TEXT NOT NULL, owner TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new',
        created_at TEXT NOT NULL, correlation_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY, request_id TEXT NOT NULL, action TEXT NOT NULL, at TEXT NOT NULL);`);
  }
  private entry(row: any): Entry {
    return {
      ...JSON.parse(row.payload),
      id: row.id,
      eventId: row.event_id,
      owner: row.owner,
      status: row.status,
      createdAt: row.created_at,
      correlationId: row.correlation_id,
      version: row.version,
    };
  }
  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  receive(
    input: Intake,
    correlationId: string,
  ): { entry: Entry; duplicate: boolean } {
    return this.transaction(() => {
      const existing = this.db
        .prepare("SELECT * FROM requests WHERE event_id=?")
        .get(input.eventId);
      if (existing) {
        if (existing.fingerprint !== fingerprint(input.request))
          throw new Problem(
            409,
            "This event ID was already used for different request details.",
          );
        return { entry: this.entry(existing), duplicate: true };
      }
      const id = randomUUID(),
        at = new Date().toISOString();
      this.db
        .prepare(
          "INSERT INTO requests (id,event_id,fingerprint,payload,created_at,correlation_id) VALUES (?,?,?,?,?,?)",
        )
        .run(
          id,
          input.eventId,
          fingerprint(input.request),
          JSON.stringify(input.request),
          at,
          correlationId,
        );
      this.db
        .prepare("INSERT INTO activity (request_id,action,at) VALUES (?,?,?)")
        .run(id, "Request received", at);
      return { entry: this.get(id), duplicate: false };
    });
  }
  list(): Entry[] {
    return this.db
      .prepare("SELECT * FROM requests ORDER BY created_at DESC, id")
      .all()
      .map((row) => this.entry(row));
  }
  get(id: string): Entry {
    const row = this.db.prepare("SELECT * FROM requests WHERE id=?").get(id);
    if (!row) throw new Problem(404, "Request not found.");
    return this.entry(row);
  }
  history(id: string): Activity[] {
    this.get(id);
    return this.db
      .prepare(
        "SELECT id, request_id AS requestId, action, at FROM activity WHERE request_id=? ORDER BY id",
      )
      .all(id) as Activity[];
  }
  update(
    id: string,
    owner: string,
    status: Status,
    expectedVersion: number,
  ): Entry {
    return this.transaction(() => {
      const current = this.get(id);
      if (current.status === "closed")
        throw new Problem(409, "Closed requests are read-only.");
      if (expectedVersion !== current.version)
        throw new Problem(409, "This request changed. Refresh before saving.");
      const allowed: Record<Status, Status[]> = {
        new: ["new", "assigned"],
        assigned: ["assigned", "in_progress"],
        in_progress: ["in_progress", "closed"],
        closed: [],
      };
      if (!allowed[current.status].includes(status))
        throw new Problem(422, "Choose the next step in the request workflow.");
      if (status !== "new" && !owner.trim())
        throw new Problem(
          422,
          "Assign an owner before moving this request forward.",
        );
      if (current.owner === owner && current.status === status) return current;
      this.db
        .prepare(
          "UPDATE requests SET owner=?,status=?,version=version+1 WHERE id=?",
        )
        .run(owner, status, id);
      const action =
        `${current.owner !== owner ? `Owner: ${owner || "unassigned"}. ` : ""}${current.status !== status ? `Status: ${status.replace("_", " ")}.` : ""}`.trim();
      this.db
        .prepare("INSERT INTO activity (request_id,action,at) VALUES (?,?,?)")
        .run(id, action, new Date().toISOString());
      return this.get(id);
    });
  }
  close() {
    this.db.close();
  }
}
