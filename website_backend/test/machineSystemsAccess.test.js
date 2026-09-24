const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/routes/authV2.js"), "utf8");
const start = source.indexOf("function machineAllowed(req)");
const end = source.indexOf("async function authenticateToken", start);
assert.ok(start >= 0 && end > start);
const machineAllowed = vm.runInNewContext(source.slice(start, end) + "\nmachineAllowed");

test("machine key can read the systems list without gaining write access to it", () => {
  assert.equal(machineAllowed({ method: "GET", path: "/systems" }), true);
  assert.equal(machineAllowed({ method: "GET", path: "/systems/ABC1234" }), true);
  assert.equal(machineAllowed({ method: "POST", path: "/systems" }), false);
  assert.equal(machineAllowed({ method: "PATCH", path: "/systems" }), false);
});
