import { mkdir, copyFile } from "node:fs/promises";
import { build } from "esbuild";
const sandbox = process.argv.includes("--sandbox");
const output = sandbox ? "dist/sandbox" : "dist/public";
await mkdir(output, { recursive: true });
await copyFile("ui/index.html", `${output}/index.html`);
await copyFile("ui/app.css", `${output}/app.css`);
await build({
  entryPoints: ["ui/app.tsx"],
  bundle: true,
  outfile: `${output}/app.js`,
  minify: true,
  define: {
    "process.env.NODE_ENV": '"production"',
    __PUBLIC_SANDBOX__: sandbox ? "true" : "false",
  },
});
console.log("Built Operations Hub");
