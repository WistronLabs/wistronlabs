const express = require("express");
const http = require("node:http");
const crypto = require("node:crypto");
const { relay } = require("./terminalProxy");
const PREFIX = "/api/v1/terminals";
const LEASE_MS = 90000;
function createTerminals({
  db,
  authenticateToken,
  socketPath,
  publicOrigin,
  frontendOrigin,
}) {
  const router = express.Router();
  const grants = new Map();
  publicOrigin = publicOrigin ? new URL(publicOrigin).origin : undefined;
  frontendOrigin = frontendOrigin ? new URL(frontendOrigin).origin : undefined;
  const enabled = !!(
    socketPath &&
    publicOrigin?.startsWith("https://") &&
    frontendOrigin
  );
  const revoke = (id) => {
    const grant = grants.get(id);
    if (grant) for (const socket of grant.sockets) socket.destroy();
    grants.delete(id);
  };
  async function user(id) {
    const { rows } = await db.query(
      "SELECT id, username, admin, super_admin, terminal_access, enabled, must_change_password, session_version FROM users WHERE id = $1",
      [id],
    );
    return rows[0]?.enabled && !rows[0].must_change_password && rows[0].terminal_access
      ? rows[0]
      : null;
  }
  async function allowed(req, res, next) {
    try {
      req.terminalUser = await user(req.user.userId);
      if (!req.terminalUser)
        return res.status(403).json({ error: "Terminal access required" });
      if (!enabled)
        return res
          .status(503)
          .json({ error: "Terminal service is not configured on this server" });
      next();
    } catch {
      res.status(503).json({ error: "Unable to verify terminal access" });
    }
  }
  router.get("/access", authenticateToken, async (req, res) => {
    try {
      res.json({ allowed: !!(await user(req.user.userId)), enabled });
    } catch {
      res.status(503).json({ error: "Unable to verify terminal access" });
    }
  });
  router.post(
    "/stations/:station/connect",
    authenticateToken,
    allowed,
    async (req, res) => {
      const station = req.params.station;
      if (!/^[1-9]\d{0,5}$/.test(station))
        return res.status(400).json({ error: "Invalid station" });
      try {
        const { rows } = await db.query(
          "SELECT id FROM station WHERE station_name = $1",
          [station],
        );
        if (!rows.length)
          return res.status(404).json({ error: "Station not found" });
        if (
          [...grants.values()].filter((g) => g.userId === req.user.userId)
            .length >= 32
        ) {
          return res
            .status(429)
            .json({ error: "Too many terminal panels open" });
        }
        const result = await new Promise((resolve, reject) => {
          const upstream = http.get(
            { socketPath, path: `${PREFIX}/stations/${station}/ensure` },
            (response) => {
              let body = "";
              response.on("data", (chunk) => {
                body += chunk;
              });
              response.on("end", () => {
                try {
                  if (response.statusCode !== 200) throw new Error();
                  resolve(JSON.parse(body));
                } catch {
                  reject(new Error("Terminal host unavailable"));
                }
              });
            },
          );
          upstream.setTimeout(10000, () =>
            upstream.destroy(new Error("Terminal host timeout")),
          );
          upstream.on("error", reject);
        });
        const id = crypto.randomUUID();
        const secret = crypto.randomBytes(32).toString("hex");
        grants.set(id, {
          secret,
          userId: req.user.userId,
          sessionVersion: req.terminalUser.session_version,
          username: req.terminalUser.username,
          station,
          expires: Date.now() + LEASE_MS,
          sockets: new Set(),
        });
        const path = `${PREFIX}/views/${id}`;
        res.cookie("terminal_session", secret, {
          httpOnly: true,
          secure: true,
          sameSite: "none",
          path,
          maxAge: LEASE_MS,
        });
        res.set("Cache-Control", "no-store").json({
          id,
          url: `${publicOrigin}${path}/`,
          newSession: result.newSession,
        });
      } catch {
        res.status(503).json({
          error:
            "Terminal host unavailable. Check the host service and socket mount.",
        });
      }
    },
  );
  router.post("/leases/:id", authenticateToken, allowed, (req, res) => {
    const grant = grants.get(req.params.id);
    if (
      !grant ||
      grant.userId !== req.user.userId ||
      grant.expires < Date.now()
    ) {
      return res
        .status(410)
        .json({ error: "Terminal connection expired. Reconnect to continue." });
    }
    grant.expires = Date.now() + LEASE_MS;
    res.cookie("terminal_session", grant.secret, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: `${PREFIX}/views/${req.params.id}`,
      maxAge: LEASE_MS,
    });
    const users = [
      ...new Set(
        [...grants.values()]
          .filter(
            (g) =>
              g.station === grant.station &&
              g.expires > Date.now() &&
              g.sockets.size,
          )
          .map((g) => g.username),
      ),
    ];
    res.json({ users, connected: grant.sockets.size > 0 });
  });
  router.delete("/leases/:id", authenticateToken, (req, res) => {
    if (grants.get(req.params.id)?.userId === req.user.userId) {
      revoke(req.params.id);
      res.clearCookie("terminal_session", {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: `${PREFIX}/views/${req.params.id}`,
      });
    }
    res.sendStatus(204);
  });
  router.post("/disconnect", authenticateToken, (req, res) => {
    for (const [id, grant] of grants)
      if (grant.userId === req.user.userId) revoke(id);
    res.sendStatus(204);
  });
  async function authorizeView(req) {
    if (!enabled) return null;
    const id = new RegExp(`^${PREFIX}/views/([a-f0-9-]{36})/`).exec(
      req.url,
    )?.[1];
    const raw = /(?:^|;\s*)terminal_session=([a-f0-9]{64})(?:;|$)/.exec(
      req.headers.cookie || "",
    )?.[1];
    const grant = grants.get(id);
    if (
      !grant ||
      !raw ||
      !crypto.timingSafeEqual(Buffer.from(raw), Buffer.from(grant.secret)) ||
      grant.expires <= Date.now()
    )
      return null;
    const currentUser = await user(grant.userId);
    if (!currentUser || currentUser.session_version !== grant.sessionVersion) {
      revoke(id);
      return null;
    }
    return grant;
  }
  // Mounted separately before Express's body parser to keep terminal paths unmodified.
  async function view(req, res) {
    try {
      const grant = await authorizeView(req);
      if (req.method !== "GET" || !grant)
        return res
          .status(403)
          .send("Terminal access expired. Reconnect from Stations.");
      res.set(
        "Content-Security-Policy",
        `frame-ancestors 'self' ${frontendOrigin}`,
      );
      res.set("Cache-Control", "no-store");
      const path = upstreamPath(req.url, grant.station);
      relay(req, res, socketPath, path, undefined, undefined, {
        containScroll: path.split("?")[0] === `${PREFIX}/stations/${grant.station}/`,
      });
    } catch {
      res.status(503).send("Terminal unavailable");
    }
  }
  function upstreamPath(url, station) {
    return url.replace(
      new RegExp(`^${PREFIX}/views/[a-f0-9-]{36}`),
      `${PREFIX}/stations/${station}`,
    );
  }
  async function upgrade(req, socket, head) {
    socket.on("error", () => socket.destroy());
    if (!req.url.startsWith(`${PREFIX}/views/`)) return socket.destroy();
    try {
      if (
        ![publicOrigin, frontendOrigin].includes(req.headers.origin) ||
        !req.url.endsWith("/ws")
      )
        return socket.destroy();
      const grant = await authorizeView(req);
      if (!grant) return socket.destroy();
      relay(
        req,
        socket,
        socketPath,
        upstreamPath(req.url, grant.station),
        head,
        (connected) => {
          if (
            grant.expires <= Date.now() ||
            ![...grants.values()].includes(grant)
          )
            return connected.destroy();
          grant.sockets.add(connected);
          connected.on("close", () => grant.sockets.delete(connected));
        },
      );
    } catch {
      socket.destroy();
    }
  }
  async function sweep() {
    for (const [id, grant] of grants) {
      try {
        if (grant.expires <= Date.now() || !(await user(grant.userId)))
          revoke(id);
      } catch {
        revoke(id);
      }
    }
  }
  const timer = setInterval(sweep, 10000);
  timer.unref();
  return {
    router,
    view,
    upgrade,
    revoke,
    grants,
    sweep,
    close() {
      clearInterval(timer);
      for (const id of grants.keys()) revoke(id);
    },
  };
}
module.exports = { createTerminals };
