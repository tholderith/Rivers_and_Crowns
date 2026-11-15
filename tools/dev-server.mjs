import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = resolve(root, "src") + sep;
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ts": "text/javascript; charset=utf-8",
};

const port = Number(process.argv[2] ?? 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Provide a TCP port from 1 to 65535.");
}

createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  try {
    const { pathname } = new URL(request.url, "http://localhost");
    const path = pathname === "/" ? resolve(root, "index.html") : resolve(root, "." + pathname);
    const extension = extname(path);
    if (pathname !== "/" && (!path.startsWith(source) || !Object.hasOwn(contentTypes, extension))) {
      response.writeHead(404).end("File not found");
      return;
    }

    let body = await readFile(path, "utf8");
    if (extension === ".ts") {
      body = stripTypeScriptTypes(body);
    }

    response.writeHead(200, {
      "Content-Type": contentTypes[extension],
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    }).end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      response.writeHead(404).end("File not found");
      return;
    }
    console.error(error);
    response.writeHead(500).end("Could not serve the requested file");
  }
}).listen(port, "127.0.0.1", () => console.log(`Rivers & Crowns: http://127.0.0.1:${port}`));
