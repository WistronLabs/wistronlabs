const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (socketPath, url) =>
  new Promise((resolve, reject) => {
    const req = http.get({ socketPath, path: url }, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
  });
test("host service reuses station processes, recreates missing sessions, and detaches without killing tmux", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "host-"));
  const bin = path.join(root, "bin");
  await fs.mkdir(bin);
  await fs.copyFile(
    path.join(__dirname, "../../terminal_host/server.cjs"),
    path.join(root, "server.cjs"),
  );
  await fs.copyFile(
    path.join(__dirname, "../src/services/terminalProxy.js"),
    path.join(root, "terminalProxy.js"),
  );
  const state = path.join(root, "state.json");
  await fs.writeFile(state, "{}");
  const log = path.join(root, "calls.jsonl");
  await fs.writeFile(
    path.join(bin, "tmux"),
    `#!${process.execPath}
const fs = require('fs'); const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify(args)+'\\n');
const state = JSON.parse(fs.readFileSync(process.env.STATE));
const name = args[args.indexOf('-t')+1]?.replace(/^=/,'') || args[args.indexOf('-s')+1];
if (args[0] === 'has-session') process.exit(state[name] ? 0 : 1);
if (args[0] === 'set-option' || args[0] === 'set-window-option') {
  const target = args[args.indexOf('-t')+1];
  // tmux 3.2a requires an explicit session/window separator here.
  process.exit(target.endsWith(':') && state[target.slice(0,-1).replace(/^=/,'')] ? 0 : 1);
}
if (args[0] === 'new-session') { const name = args[args.indexOf('-s')+1]; if(state[name]) process.exit(1); state[name]=true; fs.writeFileSync(process.env.STATE, JSON.stringify(state)); }
`,
    { mode: 0o755 },
  );
  await fs.writeFile(
    path.join(bin, "ttyd"),
    `#!${process.execPath}
const fs = require('fs'); const http = require('http'); const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify(['ttyd',...args])+'\\n');
http.createServer((req,res)=>res.end('station screen')).listen(args[args.indexOf('-i')+1]);
`,
    { mode: 0o755 },
  );
  const dir = path.join(root, "sockets");
  const control = path.join(dir, "control.sock");
  const child = spawn(process.execPath, [path.join(root, "server.cjs")], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      STATE: state,
      CALL_LOG: log,
      TERMINAL_SOCKET_DIR: dir,
      TERMINAL_WORKING_DIRECTORY: root,
      TTYD_BINARY: path.join(bin, "ttyd"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  child.stderr.on("data", (data) => {
    errors += data;
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const done = once(child, "exit");
      child.kill();
      await done;
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  for (let i = 0; i < 100; i++) {
    try {
      await fs.stat(control);
      break;
    } catch {
      await wait(20);
    }
  }
  assert.equal(child.exitCode, null, errors);
  const base = "/api/v1/terminals/stations/12";
  const responses = await Promise.all([
    get(control, `${base}/ensure`),
    get(control, `${base}/ensure`),
  ]);
  assert.equal(responses[0].status, 200);
  assert.equal(JSON.parse(responses[0].body).newSession, true);
  assert.equal(
    JSON.parse((await get(control, `${base}/ensure`)).body).newSession,
    false,
  );
  assert.equal((await get(control, `${base}/`)).body, "station screen");
  assert.equal(
    (await get(control, "/api/v1/terminals/stations/not-a-station/ensure"))
      .status,
    404,
  );
  await fs.writeFile(state, "{}");
  assert.equal(
    JSON.parse((await get(control, `${base}/ensure`)).body).newSession,
    true,
  );
  const calls = (await fs.readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(
    calls.filter((args) => args[0] === "ttyd").length,
    1,
    "one ttyd process per station",
  );
  const ttyd = calls.find((args) => args[0] === "ttyd");
  assert.equal(ttyd.includes("-W"), true);
  assert.equal(ttyd[ttyd.indexOf("-b") + 1], base);
  assert.equal(
    calls.some((args) => args[0] === "new-session" && args.includes("-A")),
    false,
    "ensure must not detach existing clients",
  );
  const exited = once(child, "exit");
  child.kill();
  await exited;
  assert.equal(
    JSON.parse(await fs.readFile(state, "utf8")).stn_12,
    true,
    "stopping web service leaves station session intact",
  );
  assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
});
