import {
  object,
  Problem,
  validate,
  type Payload,
  type Status,
} from "../src/contract.js";
import type { Entry, Activity } from "../src/store.js";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type State = {
  version: 1;
  requests: Entry[];
  history: Record<string, Activity[]>;
};
const storageKey = "operations-hub-sandbox-v1";
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const payload = (entry: Entry): Payload => ({
  title: entry.title,
  description: entry.description,
  requester: entry.requester,
  priority: entry.priority,
  dueDate: entry.dueDate,
});
function seed(): State {
  const at = new Date().toISOString(),
    dueDate = at.slice(0, 10);
  const requests: Entry[] = [
    {
      id: "sample-gate",
      eventId: "sample-gate",
      title: "Inspect the courtyard gate",
      description:
        "Check the hinge and adjust the latch so the gate closes smoothly.",
      requester: "Demo location A",
      priority: "urgent",
      dueDate,
      owner: "",
      status: "new",
      createdAt: at,
      correlationId: "sample-reference-gate",
      version: 1,
    },
    {
      id: "sample-door",
      eventId: "sample-door",
      title: "Repair the reception door closer",
      description: "Inspect the closer and adjust the closing speed.",
      requester: "Demo location B",
      priority: "normal",
      dueDate,
      owner: "Alex",
      status: "assigned",
      createdAt: at,
      correlationId: "sample-reference-door",
      version: 1,
    },
    {
      id: "sample-light",
      eventId: "sample-light",
      title: "Replace the stockroom light",
      description: "Replace the flickering light above the stockroom door.",
      requester: "Demo location C",
      priority: "normal",
      dueDate,
      owner: "Jordan",
      status: "closed",
      createdAt: at,
      correlationId: "sample-reference-light",
      version: 1,
    },
  ];
  return {
    version: 1,
    requests,
    history: Object.fromEntries(
      requests.map((r, i) => [
        r.id,
        [{ id: i + 1, requestId: r.id, action: "Sample request loaded", at }],
      ]),
    ),
  };
}
export class Sandbox {
  private failNext = false;
  constructor(private storage: StorageLike) {}
  private load(): State {
    try {
      const raw = this.storage.getItem(storageKey);
      if (!raw) return seed();
      const state = JSON.parse(raw);
      if (
        state.version !== 1 ||
        !Array.isArray(state.requests) ||
        !state.history ||
        typeof state.history !== "object"
      )
        throw new Error("Invalid sandbox data");
      return state;
    } catch {
      throw new Problem(
        503,
        "Sample data could not be read. Reset the demo to start again.",
      );
    }
  }
  private save(state: State) {
    try {
      this.storage.setItem(storageKey, JSON.stringify(state));
    } catch {
      throw new Problem(
        503,
        "This tab cannot save sample data. Allow browser storage or reset the demo.",
      );
    }
  }
  reset() {
    this.failNext = false;
    this.storage.removeItem(storageKey);
  }
  failNextDelivery() {
    this.failNext = true;
  }
  async call(path: string, options: RequestInit = {}): Promise<any> {
    const state = this.load(),
      method = options.method || "GET";
    const correlationId = `demo-${crypto.randomUUID()}`;
    if (path === "/api/requests" && method === "GET")
      return { requests: clone(state.requests), correlationId };
    if (path === "/api/sample-requests" && method === "POST") {
      const input = validate(JSON.parse(String(options.body)));
      if (this.failNext) {
        this.failNext = false;
        throw new Problem(
          503,
          "This is a simulated save failure. Retry the same delivery to see it recover.",
        );
      }
      const existing = state.requests.find((r) => r.eventId === input.eventId);
      if (existing) {
        if (JSON.stringify(payload(existing)) !== JSON.stringify(input.request))
          throw new Problem(
            409,
            "This event ID was already used for different request details.",
          );
        return { entry: clone(existing), duplicate: true, correlationId };
      }
      if (state.requests.length >= 50)
        throw new Problem(
          422,
          "This sandbox holds up to 50 sample requests. Reset the demo to start again.",
        );
      const entry: Entry = {
        ...input.request,
        id: crypto.randomUUID(),
        eventId: input.eventId,
        owner: "",
        status: "new",
        createdAt: new Date().toISOString(),
        correlationId,
        version: 1,
      };
      state.requests.unshift(entry);
      state.history[entry.id] = [
        {
          id: 1,
          requestId: entry.id,
          action: "Sample request received",
          at: entry.createdAt,
        },
      ];
      this.save(state);
      return { entry: clone(entry), duplicate: false, correlationId };
    }
    const id = path.match(/^\/api\/requests\/([^/]+)$/)?.[1];
    const current = state.requests.find((r) => r.id === id);
    if (!current) throw new Problem(404, "Request not found.");
    if (method === "GET")
      return {
        entry: clone(current),
        history: clone(state.history[current.id]),
        correlationId,
      };
    if (method === "PATCH") {
      const body = object(JSON.parse(String(options.body)));
      if (
        Object.keys(body).some(
          (k) => !["owner", "status", "version"].includes(k),
        ) ||
        typeof body.owner !== "string" ||
        body.owner.trim().length > 80 ||
        typeof body.status !== "string" ||
        !["new", "assigned", "in_progress", "closed"].includes(body.status) ||
        !Number.isInteger(body.version)
      )
        throw new Problem(
          422,
          "Send an owner, a supported status, and the current version.",
        );
      if (current.status === "closed")
        throw new Problem(409, "Closed requests are read-only.");
      if (current.version !== body.version)
        throw new Problem(409, "This request changed. Refresh before saving.");
      const allowed: Record<Status, string[]> = {
        new: ["new", "assigned"],
        assigned: ["assigned", "in_progress"],
        in_progress: ["in_progress", "closed"],
        closed: [],
      };
      if (!allowed[current.status].includes(body.status))
        throw new Problem(422, "Choose the next step in the request workflow.");
      const owner = body.owner.trim(),
        status = body.status as Status;
      if (status !== "new" && !owner)
        throw new Problem(
          422,
          "Assign an owner before moving this request forward.",
        );
      if (current.owner !== owner || current.status !== status) {
        const action =
          `${current.owner !== owner ? `Owner: ${owner || "unassigned"}. ` : ""}${current.status !== status ? `Status: ${status.replace("_", " ")}.` : ""}`.trim();
        const history = state.history[current.id];
        history.push({
          id: history.length + 1,
          requestId: current.id,
          action,
          at: new Date().toISOString(),
        });
        Object.assign(current, { owner, status, version: current.version + 1 });
        this.save(state);
      }
      return {
        entry: clone(current),
        history: clone(state.history[current.id]),
        correlationId,
      };
    }
    throw new Problem(405, "Method not allowed.");
  }
}
