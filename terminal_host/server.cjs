#!/usr/bin/env node
// Runs on the testing host as falab; backend connects through a mounted Unix socket.
const http = require("node:http");
const fs = require("node:fs");
const { spawn, execFileSync } = require("node:child_process");
const { relay } = require("./terminalProxy.js");
const directory = process.env.TERMINAL_SOCKET_DIR || "/run/wistron-terminals";
const cwd = process.env.TERMINAL_WORKING_DIRECTORY || "/home/falab";
const children = new Map();
const pending = new Map();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
process.umask(0o077);
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const control = `${directory}/control.sock`;
try {
  fs.unlinkSync(control);
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
async function ensure(station) {
  if (pending.has(station)) return pending.get(station);
  const promise = (async () => {
    const socket = `${directory}/station-${station}.sock`;
    let newSession = false;
    try {
      execFileSync("tmux", ["has-session", "-t", `=stn_${station}`], {
        stdio: "ignore",
      });
    } catch {
      newSession = true;
    }
    // Atomic creation; simultaneous browser attachments share the existing session.
    if (newSession) {
      try {
        execFileSync(
          "tmux",
          ["new-session", "-d", "-s", `stn_${station}`, "-c", cwd],
          { cwd },
        );
      } catch (error) {
        // A regular terminal may have created it between has-session and new-session.
        try {
          execFileSync("tmux", ["has-session", "-t", `=stn_${station}`], {
            stdio: "ignore",
          });
          newSession = false;
        } catch {
          throw error;
        }
      }
    }
    // Use tmux history for wheel scrolling in the browser terminal. Scope this
    // to the station session rather than changing the falab account globally.
    execFileSync("tmux", ["set-option", "-t", `=stn_${station}`, "mouse", "on"]);
    // Largest viewport avoids shrinking all viewers to the smallest browser panel.
    execFileSync("tmux", [
      "set-window-option",
      "-t",
      `=stn_${station}:`,
      "window-size",
      "largest",
    ]);
    if (children.has(station)) return { newSession };
    try {
      fs.unlinkSync(socket);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const child = spawn(
      process.env.TTYD_BINARY || "/usr/bin/ttyd",
      [
        "-W",
        "-i",
        socket,
        "-b",
        `/api/v1/terminals/stations/${station}`,
        "-t",
        "disableReconnect=true",
        "-t",
        "disableLeaveAlert=true",
        "-t",
        "fontSize=14",
        "-t",
        'theme={"background":"#334155","foreground":"#f1f5f9","cursor":"#f8fafc"}',
        "tmux",
        "new-session",
        "-A",
        "-s",
        `stn_${station}`,
        "-c",
        cwd,
      ],
      { cwd, stdio: ["ignore", "inherit", "inherit"] },
    );
    let error;
    child.once("error", (e) => {
      error = e;
    });
    child.once("exit", () => {
      children.delete(station);
    });
    for (let i = 0; i < 100; i++) {
      if (error || child.exitCode !== null)
        throw error || new Error("ttyd exited");
      if (fs.existsSync(socket)) {
        children.set(station, child);
        return { newSession };
      }
      await delay(50);
    }
    child.kill();
    throw new Error("ttyd startup timed out");
  })();
  pending.set(station, promise);
  try {
    return await promise;
  } finally {
    pending.delete(station);
  }
}
const stationFor = (url) =>
  /^\/api\/v1\/terminals\/stations\/([1-9]\d{0,5})(?:\/|$)/.exec(url)?.[1];
const server = http.createServer(async (req, res) => {
  const station = stationFor(req.url);
  if (!station || req.method !== "GET") return res.writeHead(404).end();
  try {
    const result = await ensure(station);
    if (req.url.endsWith("/ensure")) {
      return res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(result));
    }
    relay(req, res, `${directory}/station-${station}.sock`, req.url);
  } catch (e) {
    console.error(e);
    res.writeHead(503).end("Unable to start terminal");
  }
});
server.on("upgrade", async (req, socket, head) => {
  socket.on("error", () => socket.destroy());
  const station = stationFor(req.url);
  if (!station || !req.url.endsWith("/ws")) return socket.destroy();
  try {
    await ensure(station);
    relay(req, socket, `${directory}/station-${station}.sock`, req.url, head);
  } catch {
    socket.destroy();
  }
});
server.listen(control, () =>
  console.log(`Terminal host listening on ${control}`),
);
function stop() {
  for (const child of children.values()) child.kill();
  server.close();
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
