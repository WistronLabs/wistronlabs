#!/usr/bin/env node
// Runs on the testing host as falab; backend connects through a mounted Unix socket.
const http = require("node:http");
const fs = require("node:fs");
const { spawn, execFileSync } = require("node:child_process");
const { relay } = require("./terminalProxy.js");
const { createBiosIdleTracker } = require("./biosIdle.cjs");
const directory = process.env.TERMINAL_SOCKET_DIR || "/run/wistron-terminals";
const cwd = process.env.TERMINAL_WORKING_DIRECTORY || "/home/falab";
const children = new Map();
const pending = new Map();
const biosIdle = createBiosIdleTracker();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
process.umask(0o077);
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const control = `${directory}/control.sock`;
try {
  fs.unlinkSync(control);
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
async function startTtyd(key, socket, base, tmuxArgs) {
  if (children.has(key)) return;
  try {
    fs.unlinkSync(socket);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const child = spawn(
    process.env.TTYD_BINARY || "/usr/bin/ttyd",
    [
      "-W", "-i", socket, "-b", base,
      "-t", "disableReconnect=true",
      "-t", "disableLeaveAlert=true",
      "-t", "fontSize=14",
      "-t", 'theme={"background":"#334155","foreground":"#f1f5f9","cursor":"#f8fafc"}',
      "tmux", ...tmuxArgs,
    ],
    { cwd, stdio: ["ignore", "inherit", "inherit"] },
  );
  let error;
  child.once("error", (e) => { error = e; });
  child.once("exit", () => { children.delete(key); });
  for (let i = 0; i < 100; i++) {
    if (error || child.exitCode !== null) throw error || new Error("ttyd exited");
    if (fs.existsSync(socket)) {
      children.set(key, child);
      return;
    }
    await delay(50);
  }
  child.kill();
  throw new Error("ttyd startup timed out");
}
async function ensure(station) {
  const key = `station-${station}`;
  if (pending.has(key)) return pending.get(key);
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
    // The colon makes the session target explicit for tmux 3.2a as well.
    execFileSync("tmux", ["set-option", "-t", `=stn_${station}:`, "mouse", "on"]);
    // Largest viewport avoids shrinking all viewers to the smallest browser panel.
    execFileSync("tmux", [
      "set-window-option",
      "-t",
      `=stn_${station}:`,
      "window-size",
      "largest",
    ]);
    await startTtyd(key, socket, `/api/v1/terminals/stations/${station}`,
      ["new-session", "-A", "-s", `stn_${station}`, "-c", cwd]);
    return { newSession };
  })();
  pending.set(key, promise);
  try {
    return await promise;
  } finally {
    pending.delete(key);
  }
}
async function ensureBios(mac) {
  const key = `bios-${mac}`;
  if (pending.has(key)) return pending.get(key);
  const promise = (async () => {
    try {
      execFileSync("tmux", ["has-session", "-t", `=bs_${mac}`], { stdio: "ignore", timeout: 3000 });
    } catch {
      return false;
    }
    execFileSync("tmux", ["set-option", "-t", `=bs_${mac}:`, "mouse", "on"]);
    execFileSync("tmux", ["set-window-option", "-t", `=bs_${mac}:`, "window-size", "largest"]);
    await startTtyd(key, `${directory}/${key}.sock`, `/api/v1/terminals/bios/${mac}`,
      ["attach-session", "-t", `=bs_${mac}`]);
    return { newSession: false };
  })();
  pending.set(key, promise);
  try { return await promise; } finally { pending.delete(key); }
}
const stationFor = (url) =>
  /^\/api\/v1\/terminals\/stations\/([1-9]\d{0,5})(?:\/|$)/.exec(url)?.[1];
const biosFor = (url) =>
  /^\/api\/v1\/terminals\/bios\/([a-f0-9]{12})(?:\/|$)/.exec(url)?.[1];
function sessions() {
  try {
    return execFileSync("tmux", ["list-sessions", "-F", "#{session_name}"], {
      encoding: "utf8",
      timeout: 3000,
    }).split("\n").map((name) => /^stn_([1-9]\d{0,5})$/.exec(name)?.[1]).filter(Boolean);
  } catch {
    // tmux exits nonzero when its server has no sessions.
    return [];
  }
}
function biosSnapshot() {
  let lines;
  try {
    lines = execFileSync("tmux", ["list-sessions", "-F", "#{session_name}|#{@wistron_bios_open}"], {
      encoding: "utf8", timeout: 3000,
    }).split("\n");
  } catch { return { bios: [], opens: [] }; }
  const bios = lines.flatMap((line) => {
    const mac = /^bs_([a-f0-9]{12})\|/.exec(line)?.[1];
    return mac ? [mac] : [];
  });
  const active = new Set(bios);
  const opens = lines.flatMap((line) => {
    const match = /^stn_([1-9]\d{0,5})\|([a-f0-9]{12}):(\d{19})$/.exec(line);
    if (!match || !active.has(match[2])) return [];
    const age = Date.now() - Number(match[3].slice(0, 13));
    return age >= 0 && age <= 30000
      ? [{ station: match[1], mac: match[2], event: match[3] }] : [];
  });
  return { bios, opens };
}
function sweepBiosIdle() {
  let output;
  try {
    output = execFileSync("tmux", ["list-sessions", "-F", "#{session_name}|#{session_id}|#{session_created}|#{session_attached}|#{session_last_attached}"], {
      encoding: "utf8", timeout: 3000,
    });
  } catch { return; }
  for (const candidate of biosIdle.candidates(output)) {
    try {
      // Evaluate the condition and kill in tmux's command queue, so a client
      // attaching between the sweep and this command protects the session.
      const condition = `#{&&:#{==:#{session_id},${candidate.id}},#{&&:#{==:#{session_created},${candidate.created}},#{==:#{session_attached},0}}}`;
      execFileSync("tmux", ["if-shell", "-F", "-t", `=${candidate.name}:`, condition,
        `kill-session -t =${candidate.name}`], { stdio: "ignore", timeout: 3000 });
    } catch (error) { console.error(`Unable to close idle BIOS session ${candidate.name}:`, error); }
  }
}
const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/api/v1/terminals/sessions") {
    return res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
      .end(JSON.stringify({ stations: sessions() }));
  }
  if (req.method === "GET" && req.url === "/api/v1/terminals/bios/sessions") {
    return res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
      .end(JSON.stringify(biosSnapshot()));
  }
  const station = stationFor(req.url);
  const bios = biosFor(req.url);
  if ((!station && !bios) || req.method !== "GET") return res.writeHead(404).end();
  if (req.url === `/api/v1/terminals/stations/${station}/preview`) {
    const target = `=stn_${station}:`;
    try {
      execFileSync("tmux", ["has-session", "-t", `=stn_${station}`], { stdio: "ignore", timeout: 3000 });
    } catch {
      return res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" })
        .end(JSON.stringify({ error: "No existing tmux session for this station" }));
    }
    try {
      const output = execFileSync("tmux", ["capture-pane", "-p", "-J", "-S", "-80", "-t", target], {
        encoding: "utf8",
        maxBuffer: 64 * 1024,
        timeout: 3000,
      }).slice(-24 * 1024);
      return res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
        .end(JSON.stringify({ output }));
    } catch {
      return res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" })
        .end(JSON.stringify({ error: "Unable to capture station output" }));
    }
  }
  try {
    const result = station ? await ensure(station) : await ensureBios(bios);
    if (result === false) return res.writeHead(404, { "content-type": "application/json" })
      .end(JSON.stringify({ error: "BIOS session not found" }));
    if (req.url.endsWith("/ensure")) {
      return res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(result));
    }
    relay(req, res, `${directory}/${station ? `station-${station}` : `bios-${bios}`}.sock`, req.url);
  } catch (e) {
    console.error(e);
    res.writeHead(503).end("Unable to start terminal");
  }
});
server.on("upgrade", async (req, socket, head) => {
  socket.on("error", () => socket.destroy());
  const station = stationFor(req.url);
  const bios = biosFor(req.url);
  if ((!station && !bios) || !req.url.endsWith("/ws")) return socket.destroy();
  try {
    if (station) await ensure(station);
    else if (!(await ensureBios(bios))) return socket.destroy();
    relay(req, socket, `${directory}/${station ? `station-${station}` : `bios-${bios}`}.sock`, req.url, head);
  } catch {
    socket.destroy();
  }
});
server.listen(control, () =>
  console.log(`Terminal host listening on ${control}`),
);
const biosSweepTimer = setInterval(sweepBiosIdle, 60000);
biosSweepTimer.unref();
function stop() {
  clearInterval(biosSweepTimer);
  for (const child of children.values()) child.kill();
  server.close();
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
