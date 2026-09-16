// HTTP/WebSocket relay over a private Unix socket. Never forwards website credentials.
const http = require("node:http");
const zlib = require("node:zlib");
// Applied inside the iframe, not to the surrounding website. Its own scroll
// containers must stop scroll chaining; styling the iframe element cannot.
const scrollContainment = '<style id="terminal-scroll-containment">html,body,.xterm-viewport,.xterm-scrollable-element{overscroll-behavior:contain!important}</style>';
function relay(req, destination, socketPath, path, head, onConnect, options = {}) {
  const headers = { host: "localhost" };
  for (const name of [
    "accept",
    "accept-encoding",
    "origin",
    "user-agent",
    "sec-websocket-key",
    "sec-websocket-version",
    "sec-websocket-protocol",
    "sec-websocket-extensions",
  ]) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  if (head !== undefined) {
    headers.connection = "Upgrade";
    headers.upgrade = "websocket";
  }
  if (options.containScroll) headers["accept-encoding"] = "identity";
  const upstream = http.request({ socketPath, path, method: "GET", headers });
  const fail = () => {
    if (head !== undefined) destination.destroy();
    else if (!destination.headersSent)
      destination.writeHead(502).end("Terminal service unavailable");
    else destination.destroy();
  };
  upstream.on("error", fail);
  upstream.setTimeout(10000, () => upstream.destroy());
  if (head !== undefined) {
    upstream.on("upgrade", (response, socket, upstreamHead) => {
      upstream.setTimeout(0);
      socket.setTimeout(0);
      destination.setTimeout(0);
      const lines = [
        `HTTP/1.1 ${response.statusCode} ${response.statusMessage}`,
      ];
      for (let i = 0; i < response.rawHeaders.length; i += 2) {
        lines.push(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}`);
      }
      destination.write(lines.join("\r\n") + "\r\n\r\n");
      if (upstreamHead.length) destination.write(upstreamHead);
      if (head.length) socket.write(head);
      socket.on("error", () => destination.destroy());
      destination.on("error", () => socket.destroy());
      destination.on("close", () => socket.destroy());
      socket.on("close", () => destination.destroy());
      onConnect?.(destination);
      socket.pipe(destination).pipe(socket);
    });
    upstream.on("response", (response) => {
      response.resume();
      fail();
    });
    destination.on("close", () => upstream.destroy());
  } else {
    upstream.on("response", (response) => {
      const clean = { ...response.headers };
      delete clean["set-cookie"];
      if (options.containScroll && response.statusCode === 200 && /^text\/html\b/i.test(clean["content-type"] || "")) {
        const encoding = clean["content-encoding"];
        const decoder = encoding === "gzip" ? zlib.createGunzip()
          : encoding === "br" ? zlib.createBrotliDecompress()
          : encoding === "deflate" ? zlib.createInflate() : null;
        if (encoding && encoding !== "identity" && !decoder) {
          response.resume();
          return fail();
        }
        const stream = decoder ? response.pipe(decoder) : response;
        const chunks = [];
        let size = 0;
        response.on("error", fail);
        stream.on("error", fail);
        stream.on("data", (chunk) => {
          size += chunk.length;
          if (size > 16 * 1024 * 1024) {
            stream.destroy();
            response.destroy();
            fail();
          } else chunks.push(chunk);
        });
        stream.on("end", () => {
          const html = Buffer.concat(chunks).toString("utf8");
          const result = /<\/head>/i.test(html)
            ? html.replace(/<\/head>/i, scrollContainment + "</head>")
            : scrollContainment + html;
          for (const name of ["content-encoding", "content-length", "etag", "last-modified", "transfer-encoding"]) delete clean[name];
          destination.writeHead(response.statusCode, clean);
          destination.end(result);
        });
      } else {
        destination.writeHead(response.statusCode, clean);
        response.pipe(destination);
      }
    });
    destination.on("close", () => upstream.destroy());
  }
  upstream.end();
}
module.exports = { relay };
