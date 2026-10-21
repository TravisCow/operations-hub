import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Entry, Activity } from "../src/store.js";
import type { Intake, Status } from "../src/contract.js";

const labels: Record<Status, string> = {
  new: "New",
  assigned: "Assigned",
  in_progress: "In progress",
  closed: "Closed",
};
type Failure = { message: string; correlationId?: string };
async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await response.json();
  if (!response.ok)
    throw {
      message: body.error || "Unable to complete this action.",
      correlationId: body.correlationId,
    };
  return body;
}
function App() {
  const [requests, setRequests] = useState<Entry[]>([]),
    [selected, setSelected] = useState<string>("");
  const [detail, setDetail] = useState<{
    entry: Entry;
    history: Activity[];
  } | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<Failure | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all");
  const [refresh, setRefresh] = useState(0),
    [owner, setOwner] = useState(""),
    [status, setStatus] = useState<Status>("new");
  const [lastDelivery, setLastDelivery] = useState<Intake | null>(null),
    [deliveryResult, setDeliveryResult] = useState<{
      duplicate: boolean;
      correlationId: string;
    } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api("/api/requests", { signal: controller.signal })
      .then((result) => setRequests(result.requests))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    setDetail(null);
    if (!selected) return;
    const controller = new AbortController();
    api(`/api/requests/${selected}`, { signal: controller.signal })
      .then((result) => {
        setDetail(result);
        setOwner(result.entry.owner);
        setStatus(result.entry.status);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e);
      });
    return () => controller.abort();
  }, [selected, refresh]);

  async function deliver(payload: Intake) {
    setBusy(true);
    setError(null);
    setDeliveryResult(null);
    setLastDelivery(payload);
    try {
      const result = await api("/api/sample-requests", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setDeliveryResult(result);
      setSelected(result.entry.id);
      setShowForm(false);
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(e as Failure);
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await deliver({
      eventId: crypto.randomUUID(),
      request: {
        title: String(form.get("title")),
        description: String(form.get("description")),
        requester: String(form.get("requester")),
        priority: form.get("priority") as "normal" | "urgent",
        dueDate: String(form.get("dueDate")),
      },
    });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api(`/api/requests/${detail.entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ owner, status, version: detail.entry.version }),
      });
      setDetail(result);
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(e as Failure);
    } finally {
      setBusy(false);
    }
  }
  const visible = requests.filter(
    (r) =>
      (filter === "all" || r.status === filter) &&
      `${r.title} ${r.requester} ${r.owner}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const active = requests.filter((r) => r.status !== "closed").length;
  const allowed: Record<Status, Status[]> = {
    new: ["new", "assigned"],
    assigned: ["assigned", "in_progress"],
    in_progress: ["in_progress", "closed"],
    closed: ["closed"],
  };
  return (
    <div className="shell">
      <aside className="rail">
        <a href="/" className="brand" aria-label="Operations Hub home">
          <span className="brand-icon">
            O<span>H</span>
          </span>
          <span>
            Operations
            <br />
            <strong>Hub</strong>
          </span>
        </a>
        <div className="workspace-label">FIELDWORK / DEMO WORKSPACE</div>
        <div className="rail-item">
          <span>◫</span> Request queue <b>{requests.length}</b>
        </div>
        <div className="rail-note">
          <span className="dot" /> Local prototype
          <p>
            Fictional maintenance requests.
            <br />
            Your work is saved on this computer.
          </p>
        </div>
      </aside>
      <main className="main">
        <header>
          <div>
            <div className="eyebrow">WORKSPACE / OPERATIONS</div>
            <h1>Keep good work moving.</h1>
            <p className="subtitle">
              One place for incoming requests, clear ownership, and the next
              step.
            </p>
          </div>
          <button
            className="primary"
            onClick={() => {
              setShowForm((v) => !v);
              setError(null);
            }}
          >
            {showForm ? "Close sample form" : "+ New sample request"}
          </button>
        </header>
        <section className="metrics" aria-label="Request summary">
          <div>
            <span>Active requests</span>
            <strong>{active.toString().padStart(2, "0")}</strong>
            <small>Ready for your next move</small>
          </div>
          <div>
            <span>Awaiting assignment</span>
            <strong>
              {requests
                .filter((r) => r.status === "new")
                .length.toString()
                .padStart(2, "0")}
            </strong>
            <small>Give every request an owner</small>
          </div>
          <div>
            <span>Completed</span>
            <strong>
              {requests
                .filter((r) => r.status === "closed")
                .length.toString()
                .padStart(2, "0")}
            </strong>
            <small>A record of work done</small>
          </div>
        </section>
        {error && (
          <div className="error" role="alert">
            <strong>Something needs your attention.</strong>
            <p>{error.message}</p>
            {error.correlationId && (
              <small>Reference: {error.correlationId}</small>
            )}
            <button
              onClick={() => {
                setError(null);
                setRefresh((v) => v + 1);
              }}
            >
              Refresh workspace
            </button>
          </div>
        )}
        {deliveryResult && (
          <div className="notice" role="status">
            <span>
              <strong>
                {deliveryResult.duplicate
                  ? "Delivery recognized."
                  : "Request received."}
              </strong>{" "}
              {deliveryResult.duplicate
                ? "The existing request is unchanged. No duplicate was created."
                : "Saved and ready to assign."}
            </span>
            <button
              disabled={busy}
              onClick={() => lastDelivery && deliver(lastDelivery)}
            >
              Resend last delivery
            </button>
          </div>
        )}
        {lastDelivery && error && (
          <button
            className="retry"
            disabled={busy}
            onClick={() => deliver(lastDelivery)}
          >
            Retry last delivery
          </button>
        )}
        {showForm && (
          <section className="sample-form panel">
            <div>
              <div className="eyebrow">SAMPLE REQUEST FORM</div>
              <h2>Bring a request into the queue.</h2>
              <p>
                This fictional form delivers to the Hub through its server-side
                integration. Use sample details only.
              </p>
            </div>
            <form onSubmit={submit}>
              <div className="form-grid">
                <label>
                  Request title
                  <input
                    name="title"
                    required
                    maxLength={120}
                    defaultValue="Repair the reception door closer"
                  />
                </label>
                <label>
                  Requester reference
                  <input
                    name="requester"
                    required
                    maxLength={80}
                    defaultValue="Demo location A"
                  />
                </label>
                <label>
                  Priority
                  <select name="priority">
                    <option value="normal">Normal</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </label>
                <label>
                  Due date
                  <input
                    name="dueDate"
                    type="date"
                    required
                    defaultValue={new Date().toISOString().slice(0, 10)}
                  />
                </label>
              </div>
              <label>
                What needs doing?
                <textarea
                  name="description"
                  required
                  maxLength={1000}
                  defaultValue="The door is closing too quickly. Inspect the closer and adjust the closing speed."
                />
              </label>
              <button className="primary" disabled={busy}>
                {busy ? "Sending…" : "Send sample request"}
              </button>
            </form>
          </section>
        )}
        <section className="board">
          <div className="queue panel">
            <div className="panel-heading">
              <div>
                <h2>Request queue</h2>
                <p>
                  {visible.length}{" "}
                  {visible.length === 1 ? "request" : "requests"} in this view
                </p>
              </div>
              <button
                className="subtle"
                onClick={() => {
                  setError(null);
                  setRefresh((v) => v + 1);
                }}
                aria-label="Refresh request queue"
              >
                ↻ Refresh
              </button>
            </div>
            <div className="filters">
              <label className="search">
                <span className="sr-only">Search requests</span>
                <input
                  placeholder="Search requests or owners…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label>
                <span className="sr-only">Filter by status</span>
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">All statuses</option>
                  {Object.entries(labels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {loading ? (
              <div className="empty" role="status">
                Loading your workspace…
              </div>
            ) : visible.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">↗</div>
                <h3>
                  {requests.length
                    ? "No matching requests."
                    : "A clear queue. A fresh start."}
                </h3>
                <p>
                  {requests.length
                    ? "Try a different search or status."
                    : "Send your first sample request to see the workflow in action."}
                </p>
                {!requests.length && (
                  <button onClick={() => setShowForm(true)}>
                    Create a sample request
                  </button>
                )}
              </div>
            ) : (
              <ul className="requests">
                {visible.map((r) => (
                  <li key={r.id}>
                    <button
                      className={`request-row ${r.id === selected ? "selected" : ""}`}
                      onClick={() => {
                        setSelected(r.id);
                        setError(null);
                      }}
                      aria-pressed={r.id === selected}
                    >
                      <div className="row-top">
                        <span className={`pill ${r.status}`}>
                          {labels[r.status]}
                        </span>
                        {r.priority === "urgent" && (
                          <span className="urgent">↑ Urgent</span>
                        )}
                      </div>
                      <strong>{r.title}</strong>
                      <div className="row-meta">
                        <span>{r.requester}</span>
                        <span>Due {r.dueDate}</span>
                      </div>
                      <div className="row-owner">
                        <span className="avatar">
                          {r.owner ? r.owner[0] : "–"}
                        </span>
                        {r.owner || "Unassigned"}
                        <span className="arrow">↗</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <aside className="detail panel" aria-label="Selected request">
            {!selected ? (
              <div className="empty detail-empty">
                <div className="eyebrow">THE NEXT STEP</div>
                <h2>
                  Every request
                  <br />
                  has a story.
                </h2>
                <p>
                  Select a request to review its details, assign an owner, and
                  keep it moving.
                </p>
              </div>
            ) : !detail ? (
              <p className="detail-padding" role="status">
                Loading request…
              </p>
            ) : (
              <>
                <div className="detail-heading">
                  <span className={`pill ${detail.entry.status}`}>
                    {labels[detail.entry.status]}
                  </span>
                  <h2>{detail.entry.title}</h2>
                  <p>{detail.entry.description}</p>
                  <div className="detail-meta">
                    <span>
                      Requested by<strong>{detail.entry.requester}</strong>
                    </span>
                    <span>
                      Due date<strong>{detail.entry.dueDate}</strong>
                    </span>
                  </div>
                </div>
                <form className="detail-form" onSubmit={save}>
                  <fieldset disabled={busy || detail.entry.status === "closed"}>
                    <legend className="sr-only">Assignment and status</legend>
                    <label>
                      Owner
                      <input
                        value={owner}
                        placeholder="e.g. Alex (sample owner)"
                        maxLength={80}
                        onChange={(e) => setOwner(e.target.value)}
                      />
                    </label>
                    <label>
                      Status
                      <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value as Status)}
                      >
                        {allowed[detail.entry.status].map((s) => (
                          <option key={s} value={s}>
                            {labels[s]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="primary" type="submit">
                      {busy ? "Saving…" : "Save changes"}
                    </button>
                  </fieldset>
                  {detail.entry.status === "closed" && (
                    <p className="closed-note">
                      Completed requests are read-only.
                    </p>
                  )}
                </form>
                <section className="history">
                  <h3>Activity</h3>
                  <ol>
                    {detail.history.map((a) => (
                      <li key={a.id}>
                        <span className="history-dot" />
                        <div>
                          <strong>{a.action}</strong>
                          <time dateTime={a.at}>
                            {new Date(a.at).toLocaleString()}
                          </time>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <details>
                    <summary>Delivery details</summary>
                    <p>Event: {detail.entry.eventId}</p>
                    <p>Reference: {detail.entry.correlationId}</p>
                    <p>
                      Saved once. Repeat deliveries return this same request.
                    </p>
                  </details>
                </section>
              </>
            )}
          </aside>
        </section>
        <footer>
          Operations Hub · Original portfolio prototype{" "}
          <span>Fictional data. No real service requests are sent.</span>
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
