import { mkdir, copyFile } from "node:fs/promises";
import { build } from "esbuild";
await mkdir("dist/public", { recursive: true });
await copyFile("ui/index.html", "dist/public/index.html");
await copyFile("ui/app.css", "dist/public/app.css");
await build({
  entryPoints: ["ui/app.tsx"],
  bundle: true,
  outfile: "dist/public/app.js",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
});
console.log("Built Operations Hub");
