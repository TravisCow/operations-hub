import { createHash } from "node:crypto";

export type Status = "new" | "assigned" | "in_progress" | "closed";
export type Payload = {
  title: string;
  description: string;
  requester: string;
  priority: "normal" | "urgent";
  dueDate: string;
};
export type Intake = { eventId: string; request: Payload };
export class Problem extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Problem(422, "Send a JSON object.");
  return value as Record<string, unknown>;
}
function field(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new Problem(422, `${label} is required (up to ${max} characters).`);
  return value.trim();
}
export function validate(value: unknown): Intake {
  const body = object(value);
  if (Object.keys(body).some((k) => !["eventId", "request"].includes(k)))
    throw new Problem(422, "Unknown event field.");
  const eventId = field(body.eventId, "Event ID", 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(eventId))
    throw new Problem(
      422,
      "Event ID may contain letters, numbers, underscores, and hyphens.",
    );
  const req = object(body.request);
  if (
    Object.keys(req).some(
      (k) =>
        !["title", "description", "requester", "priority", "dueDate"].includes(
          k,
        ),
    )
  )
    throw new Problem(422, "Unknown request field.");
  if (typeof req.priority !== "string" || !["normal", "urgent"].includes(req.priority))
    throw new Problem(422, "Choose normal or urgent priority.");
  const dueDate = field(req.dueDate, "Due date", 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ||
    !Number.isFinite(Date.parse(dueDate)) ||
    new Date(dueDate).toISOString().slice(0, 10) !== dueDate
  )
    throw new Problem(422, "Choose a valid due date.");
  return {
    eventId,
    request: {
      title: field(req.title, "Title", 120),
      description: field(req.description, "Description", 1000),
      requester: field(req.requester, "Requester reference", 80),
      priority: req.priority as Payload["priority"],
      dueDate,
    },
  };
}
export function fingerprint(request: Payload) {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}
