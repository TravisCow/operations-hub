import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { object, Problem, validate, type Status } from "./contract.js";
import { Store } from "./store.js";

async function jsonBody(req: IncomingMessage) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new Problem(415, "Send application/json.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw new Problem(413, "Request is too large.");
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Problem(400, "Request body is not valid JSON.");
  }
}
type Options = {
  beforeReceive?: () => void;
  log?: (event: Record<string, unknown>) => void;
};
export function createHub(
  store: Store,
  integrationKey: string,
  options: Options = {},
) {
  if (integrationKey.length < 24)
    throw new Error("Use an integration key of at least 24 characters.");
  const keyHash = createHash("sha256").update(integrationKey).digest();
  const server = createServer(async (req, res) => {
    let correlationId: string = randomUUID();
    let responseStatus = 500;
    const reply = (status: number, body: Record<string, unknown>) => {
      responseStatus = status;
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Correlation-ID": correlationId,
      });
      res.end(JSON.stringify({ ...body, correlationId }));
    };
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const port = (server.address() as { port: number }).port;
      const hosts = [`localhost:${port}`, `127.0.0.1:${port}`];
      if (!hosts.includes(req.headers.host || ""))
        throw new Problem(403, "This prototype only accepts local requests.");
      if (
        req.headers.origin &&
        !hosts.some((host) => req.headers.origin === `http://${host}`)
      )
        throw new Problem(403, "Cross-origin requests are not allowed.");
      const url = new URL(req.url || "/", "http://localhost");
      if (req.method === "POST" && url.pathname === "/webhooks/requests") {
        const supplied = createHash("sha256")
          .update(String(req.headers["x-integration-key"] || ""))
          .digest();
        if (!timingSafeEqual(keyHash, supplied))
          throw new Problem(
            401,
            "Integration credential is missing or incorrect.",
          );
        const input = validate(await jsonBody(req));
        options.beforeReceive?.();
        const result = store.receive(input, correlationId);
        reply(result.duplicate ? 200 : 201, result);
      } else if (
        req.method === "POST" &&
        url.pathname === "/api/sample-requests"
      ) {
        const input = validate(await jsonBody(req));
        // A real HTTP delivery from the server-side form adapter. The browser never receives the key.
        const delivery = await fetch(
          `http://127.0.0.1:${port}/webhooks/requests`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Integration-Key": integrationKey,
            },
            body: JSON.stringify(input),
            signal: AbortSignal.timeout(5000),
          },
        );
        const result = (await delivery.json()) as Record<string, unknown>;
        correlationId = String(result.correlationId);
        reply(delivery.status, result);
      } else if (req.method === "GET" && url.pathname === "/api/requests") {
        reply(200, { requests: store.list() });
      } else if (/^\/api\/requests\/[a-f0-9-]+$/.test(url.pathname)) {
        const id = url.pathname.split("/").at(-1)!;
        if (req.method === "GET")
          reply(200, { entry: store.get(id), history: store.history(id) });
        else if (req.method === "PATCH") {
          const body = object(await jsonBody(req));
          if (
            Object.keys(body).some(
              (k) => !["owner", "status", "version"].includes(k),
            )
          )
            throw new Problem(422, "Unknown update field.");
          if (
            typeof body.owner !== "string" ||
            body.owner.trim().length > 80 ||
            typeof body.status !== "string" ||
            !["new", "assigned", "in_progress", "closed"].includes(
              body.status,
            ) ||
            !Number.isInteger(body.version)
          )
            throw new Problem(
              422,
              "Send an owner, a supported status, and the current version.",
            );
          const entry = store.update(
            id,
            body.owner.trim(),
            body.status as Status,
            body.version as number,
          );
          reply(200, { entry, history: store.history(id) });
        } else throw new Problem(405, "Method not allowed.");
      } else if (
        req.method === "GET" &&
        ["/", "/app.js", "/app.css"].includes(url.pathname)
      ) {
        const filename =
          url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        const content = await readFile(
          fileURLToPath(new URL(`../public/${filename}`, import.meta.url)),
        );
        responseStatus = 200;
        res.writeHead(200, {
          "Content-Type": filename.endsWith(".html")
            ? "text/html"
            : filename.endsWith(".css")
              ? "text/css"
              : "text/javascript",
        });
        res.end(content);
      } else throw new Problem(404, "Not found.");
    } catch (error) {
      if (error instanceof Problem)
        reply(error.status, { error: error.message, retryable: false });
      else {
        res.setHeader("Retry-After", "2");
        reply(503, {
          error:
            "We could not save or retrieve this request. Please try again.",
          retryable: true,
        });
      }
    } finally {
      options.log?.({
        correlationId,
        method: req.method,
        status: responseStatus,
      });
    }
  });
  return server;
}
