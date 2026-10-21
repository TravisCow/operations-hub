import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const config = JSON.parse(
  await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
);
const security = Object.fromEntries(
  config.headers[0].headers.map((h) => [h.key, h.value]),
);
createServer(async (req, res) => {
  const name = {
    "/": "index.html",
    "/app.js": "app.js",
    "/app.css": "app.css",
  }[req.url];
  if (!name) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  try {
    const body = await readFile(
      new URL("../dist/sandbox/" + name, import.meta.url),
    );
    res.writeHead(200, {
      ...security,
      "Content-Type": name.endsWith(".js")
        ? "text/javascript"
        : name.endsWith(".css")
          ? "text/css"
          : "text/html",
    });
    res.end(body);
  } catch {
    res.writeHead(503);
    res.end("Build the sandbox first.");
  }
}).listen(5101, "127.0.0.1", () =>
  console.log("Sandbox preview: http://localhost:5101/"),
);
