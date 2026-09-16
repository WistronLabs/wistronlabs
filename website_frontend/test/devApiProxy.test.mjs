import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { createServer } from "vite";
import { createDevApiProxy, localCookie } from "../dev/apiProxy.js";

test("local cookie adaptation preserves HttpOnly, scope and expiry", () => {
  assert.equal(
    localCookie(
      "terminal_session=secret; Path=/api/v1/terminals/views/id; Max-Age=90; HttpOnly; Secure; SameSite=None",
    ),
    "terminal_session=secret; Path=/api/v1/terminals/views/id; Max-Age=90; HttpOnly; SameSite=Lax",
  );
});

test("Vite proxy forwards auth, cookies and WebSockets with the original browser origin", async (t) => {
  const received = [];
  const sockets = new Set();
  const backend = http.createServer((req, res) => {
    received.push({ url: req.url, headers: req.headers });
    res.setHeader(
      "Set-Cookie",
      "terminal_session=secret; Path=/api/v1/terminals/views/id; HttpOnly; Secure; SameSite=None",
    );
    res.setHeader(
      "Content-Security-Policy",
      "frame-ancestors https://remote.example",
    );
    res.end("terminal");
  });
  backend.on("upgrade", (req, socket) => {
    received.push({ url: req.url, headers: req.headers });
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    const accept = crypto
      .createHash("sha1")
      .update(
        req.headers["sec-websocket-key"] +
          "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      )
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.on("data", (data) => socket.write(data));
  });
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const vite = await createServer({
    configFile: false,
    logLevel: "silent",
    appType: "custom",
    server: {
      host: "127.0.0.1",
      port: 0,
      proxy: createDevApiProxy(
        `http://127.0.0.1:${backend.address().port}/api/v1`,
      ),
    },
  });
  await vite.listen();
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await vite.close();
    backend.closeAllConnections();
    await new Promise((resolve) => backend.close(resolve));
  });
  const port = vite.httpServer.address().port;
  const origin = `http://localhost:${port}`;
  const response = await fetch(
    `http://127.0.0.1:${port}/api/v1/terminals/views/id/`,
    {
      headers: {
        Host: `localhost:${port}`,
        Authorization: "Bearer test-token",
        Cookie: "terminal_session=secret",
      },
    },
  );
  assert.equal(await response.text(), "terminal");
  assert.doesNotMatch(
    response.headers.get("set-cookie"),
    /Secure|SameSite=None/,
  );
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  assert.equal(
    response.headers.get("content-security-policy"),
    "frame-ancestors 'self'",
  );
  assert.equal(received[0].headers.authorization, "Bearer test-token");
  assert.equal(received[0].headers.cookie, "terminal_session=secret");
  const ws = await new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: "/api/v1/terminals/views/id/ws",
      headers: {
        Host: `localhost:${port}`,
        Origin: origin,
        Cookie: "terminal_session=secret",
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64"),
      },
    });
    req.on("upgrade", (res, socket) => resolve(socket));
    req.on("error", reject);
    req.end();
  });
  assert.equal(
    received.at(-1).headers.origin,
    origin,
    "do not bypass backend Origin validation",
  );
  assert.equal(received.at(-1).headers.cookie, "terminal_session=secret");
  const echo = new Promise((resolve) => ws.once("data", resolve));
  ws.write(Buffer.from([0x82, 0x01, 0x41]));
  assert.deepEqual(await echo, Buffer.from([0x82, 0x01, 0x41]));
  ws.destroy();
});
