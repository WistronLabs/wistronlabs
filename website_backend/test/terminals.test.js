const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const express = require("express");
const { PGlite } = require("@electric-sql/pglite");
const { createTerminals } = require("../src/services/terminals");

const listen = (server, where) =>
  new Promise((resolve) =>
    server.listen(where, () => resolve(server.address())),
  );
function upgrade(port, cookie, origin = "https://backend.test", viewId) {
  return new Promise((resolve) => {
    const req = http.request({
      port,
      path: `/api/v1/terminals/views/${viewId}/ws`,
      headers: {
        cookie,
        origin,
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": crypto.randomBytes(16).toString("base64"),
        "sec-websocket-protocol": "tty",
      },
    });
    req.on("upgrade", (res, socket) => resolve({ res, socket }));
    req.on("error", () => resolve(null));
    req.on("response", (res) => {
      res.resume();
      resolve(null);
    });
    req.end();
  });
}
test("terminal gateway: permissions, station isolation, proxy traffic, presence, expiry and logout", async (t) => {
  const pg = new PGlite();
  await pg.exec(
    "CREATE TABLE users(id int PRIMARY KEY,username text,admin boolean); CREATE TABLE station(id int,station_name text); INSERT INTO station VALUES(1,'12'),(2,'18'); INSERT INTO users VALUES(1,'admin@test',true),(2,'tech@test',false),(3,'viewer@test',false);",
  );
  await pg.exec(
    await fs.readFile(
      path.join(__dirname, "../db_migrations/0018-terminal-access.sql"),
      "utf8",
    ),
  );
  await pg.exec(
    "ALTER TABLE users ADD COLUMN super_admin boolean DEFAULT false; ALTER TABLE users ADD COLUMN enabled boolean DEFAULT true; ALTER TABLE users ADD COLUMN must_change_password boolean DEFAULT false; ALTER TABLE users ADD COLUMN session_version integer DEFAULT 1;",
  );
  await pg.exec("UPDATE users SET terminal_access=true WHERE id=2");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "terminal-"));
  const socketPath = path.join(dir, "control.sock");
  let forwarded;
  const hostSockets = new Set();
  const host = http.createServer((req, res) => {
    forwarded = req.headers;
    if (req.url.endsWith("/ensure"))
      res
        .writeHead(200, { "content-type": "application/json" })
        .end('{"newSession":true}');
    else if (req.url.endsWith("/app.js")) res.writeHead(200, { "content-type": "application/javascript" }).end("/* terminal asset */");
    else {
      const content = "<!doctype html><html><head></head><body>terminal html</body></html>";
      const encoding = new URL(req.url, "http://host").searchParams.get("encoding");
      const body = encoding === "gzip" ? zlib.gzipSync(content) : encoding === "br" ? zlib.brotliCompressSync(content) : content;
      res.writeHead(200, { "content-type": "text/html", "content-length": Buffer.byteLength(body), ...(encoding ? { "content-encoding": encoding } : {}) }).end(body);
    }
  });
  host.on("upgrade", (req, socket) => {
    forwarded = req.headers;
    hostSockets.add(socket);
    socket.on("close", () => hostSockets.delete(socket));
    const accept = crypto
      .createHash("sha1")
      .update(
        req.headers["sec-websocket-key"] +
          "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      )
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: tty\r\n\r\n`,
    );
    socket.on("data", (data) => socket.write(data));
    socket.on("end", () => socket.end());
  });
  await listen(host, socketPath);
  const app = express();
  app.use(express.json());
  const authenticateToken = (req, res, next) => {
    const id = Number(req.headers.authorization?.replace("Bearer ", ""));
    if (!id) return res.sendStatus(401);
    req.user = { userId: id };
    next();
  };
  const terminals = createTerminals({
    db: pg,
    authenticateToken,
    socketPath,
    publicOrigin: "https://backend.test",
    frontendOrigin: "https://frontend.test",
  });
  app.use("/api/v1/terminals", terminals.router);
  app.get(/^\/api\/v1\/terminals\/views\/.*$/, terminals.view);
  const server = http.createServer(app);
  server.on("upgrade", terminals.upgrade);
  const { port } = await listen(server, 0);
  t.after(async () => {
    terminals.close();
    for (const socket of hostSockets) socket.destroy();
    server.closeAllConnections();
    host.closeAllConnections();
    await Promise.all([
      new Promise((r) => server.close(r)),
      new Promise((r) => host.close(r)),
    ]);
    await pg.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const call = (route, id, method = "GET", headers = {}) =>
    fetch(`http://localhost:${port}/api/v1/terminals${route}`, {
      method,
      headers: { ...(id ? { authorization: `Bearer ${id}` } : {}), ...headers },
    });
  assert.equal((await call("/access")).status, 401);
  assert.equal(
    (await (await call("/access", 1)).json()).allowed,
    false,
    "admin does not inherit terminal access",
  );
  assert.equal((await (await call("/access", 2)).json()).allowed, true);
  assert.equal((await call("/stations/12/connect", 3, "POST")).status, 403);
  assert.equal((await call("/stations/99/connect", 1, "POST")).status, 403);
  assert.equal((await call("/stations/abc/connect", 2, "POST")).status, 400);
  const res = await call("/stations/12/connect", 2, "POST");
  assert.equal(res.status, 200);
  const grant = await res.json();
  const cookie = res.headers.get("set-cookie").split(";")[0];
  assert.match(res.headers.get("set-cookie"), /HttpOnly/);
  assert.match(res.headers.get("set-cookie"), /Secure/);
  assert.equal((await call(`/views/${grant.id}/`)).status, 403);
  assert.equal(
    (await call(`/views/${crypto.randomUUID()}/`, null, "GET", { cookie }))
      .status,
    403,
  );
  const html = await call(`/views/${grant.id}/`, null, "GET", { cookie });
  const htmlBody = await html.text();
  assert.match(htmlBody, /terminal-scroll-containment/);
  assert.match(htmlBody, /overscroll-behavior:contain!important/);
  assert.match(htmlBody, /<body>terminal html<\/body>/);
  assert.equal(forwarded["accept-encoding"], "identity");
  for (const encoding of ["gzip", "br"]) {
    const compressed = await call(`/views/${grant.id}/?encoding=${encoding}`, null, "GET", { cookie });
    assert.equal(compressed.headers.get("content-encoding"), null);
    assert.equal(await compressed.text(), htmlBody);
  }
  const asset = await call(`/views/${grant.id}/app.js`, null, "GET", { cookie });
  assert.equal(await asset.text(), "/* terminal asset */");
  assert.match(
    html.headers.get("content-security-policy"),
    /frame-ancestors 'self' https:\/\/frontend.test/,
  );
  assert.equal(
    (
      await call(`/views/${grant.id}/`, null, "GET", {
        cookie: `terminal_session=${grant.id}`,
      })
    ).status,
    403,
    "view URL is not a credential",
  );
  assert.equal(forwarded.cookie, undefined);
  assert.equal(forwarded.authorization, undefined);
  assert.equal(
    await upgrade(port, cookie, "https://evil.test", grant.id),
    null,
  );
  assert.equal(
    await upgrade(port, cookie, "https://backend.test", crypto.randomUUID()),
    null,
  );
  const ws = await upgrade(port, cookie, "https://backend.test", grant.id);
  assert.equal(ws.res.statusCode, 101);
  const frontendWs = await upgrade(
    port,
    cookie,
    "https://frontend.test",
    grant.id,
  );
  assert.equal(
    frontendWs.res.statusCode,
    101,
    "configured frontend origin can connect through the dev proxy",
  );
  frontendWs.socket.destroy();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(ws.res.headers["sec-websocket-protocol"], "tty");
  const echoed = new Promise((resolve) => ws.socket.once("data", resolve));
  ws.socket.write(Buffer.from([0x82, 0x02, 0x41, 0x42]));
  assert.deepEqual(await echoed, Buffer.from([0x82, 0x02, 0x41, 0x42]));
  const presence = await (await call(`/leases/${grant.id}`, 2, "POST")).json();
  assert.deepEqual(presence.users, ["tech@test"]);
  assert.equal(presence.connected, true);
  assert.equal((await call(`/leases/${grant.id}`, 1, "POST")).status, 403);
  await call(`/leases/${grant.id}`, 1, "DELETE");
  assert.equal(
    terminals.grants.has(grant.id),
    true,
    "other users cannot disconnect this lease",
  );
  const otherResponse = await call("/stations/12/connect", 2, "POST");
  const other = await otherResponse.json();
  const otherCookie = otherResponse.headers.get("set-cookie").split(";")[0];
  assert.notEqual(
    otherResponse.headers.get("set-cookie").match(/Path=([^;]+)/)[1],
    res.headers.get("set-cookie").match(/Path=([^;]+)/)[1],
  );
  assert.equal(
    await upgrade(port, cookie, "https://backend.test", other.id),
    null,
    "cookie is bound to one panel",
  );
  const otherWs = await upgrade(
    port,
    otherCookie,
    "https://backend.test",
    other.id,
  );
  const otherClosed = new Promise((resolve) =>
    otherWs.socket.once("close", resolve),
  );
  await call(`/leases/${other.id}`, 2, "DELETE");
  await otherClosed;
  assert.equal(
    terminals.grants.get(grant.id).sockets.size,
    1,
    "closing another panel leaves this panel connected",
  );
  const closed = new Promise((resolve) => ws.socket.once("close", resolve));
  await call("/disconnect", 2, "POST");
  await closed;
  assert.equal(
    await upgrade(port, cookie, "https://backend.test", grant.id),
    null,
    "logout invalidates old cookie",
  );
  const second = await call("/stations/12/connect", 2, "POST");
  const secondGrant = await second.json();
  const secondCookie = second.headers.get("set-cookie").split(";")[0];
  const activeSecond = await upgrade(
    port,
    secondCookie,
    "https://backend.test",
    secondGrant.id,
  );
  const removed = new Promise((resolve) =>
    activeSecond.socket.once("close", resolve),
  );
  await pg.exec("UPDATE users SET terminal_access=false WHERE id=2");
  await terminals.sweep();
  await removed;
  assert.equal(
    (await call(`/leases/${secondGrant.id}`, 2, "POST")).status,
    403,
  );
  assert.equal(
    await upgrade(port, secondCookie, "https://backend.test", secondGrant.id),
    null,
    "revoked permission cannot reconnect",
  );
  await pg.exec("UPDATE users SET terminal_access=true WHERE id=1");
  const adminGrant = await (
    await call("/stations/12/connect", 1, "POST")
  ).json();
  terminals.grants.get(adminGrant.id).expires = Date.now() - 1;
  assert.equal(
    (await call(`/leases/${adminGrant.id}`, 1, "POST")).status,
    410,
    "expired lease cannot be renewed",
  );
});
