const { spawn } = require("node:child_process");
const { readFile } = require("node:fs/promises");

const SETTING_KEY = "print_profiles";
const DOCUMENTS = Object.freeze({
  system_id: { name: "System ID label", printer: "zebra", media: "Custom.2x1in" },
  rma_label: { name: "RMA label", printer: "zebra", media: "Custom.2x1in" },
  l10_pass: { name: "L10 Pass label", printer: "zebra", media: "Custom.2x1in" },
  pending_parts: { name: "Pending Parts label", printer: "zebra", media: "Custom.2x1in" },
  pallet_sheet: { name: "Pallet paper", printer: "brother", media: "Letter" },
});
const DEFAULT_PROFILES = Object.fromEntries(Object.entries(DOCUMENTS).map(([kind, document]) => [kind, {
  printer: document.printer,
  media: document.media,
  copies: 1,
  orientation: "portrait",
  scaling: "none",
}]));
const DEFAULT_PRINTERS = Object.freeze([
  { id: "zebra", name: "ZD421", queue: "" },
  { id: "brother", name: "Brother", queue: "" },
]);
const SAFE_OPTION = /^[A-Za-z0-9_.+/-]{1,80}$/;

function validatePrinters(input, availableQueues) {
  if (!Array.isArray(input) || input.length > 30) throw new Error("Printers must be a list of at most 30 entries");
  const seen = new Set();
  return input.map((raw) => {
    const id = String(raw?.id || "").trim();
    const name = String(raw?.name || "").trim();
    const queue = String(raw?.queue || "").trim();
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(id) || seen.has(id)) throw new Error("Printer IDs must be unique, lowercase names");
    if (!name || name.length > 80) throw new Error(`Invalid name for printer ${id}`);
    if (queue && !availableQueues.includes(queue)) throw new Error(`${queue} is not an installed CUPS queue`);
    seen.add(id);
    return { id, name, queue };
  });
}

function validateProfiles(input, printers = DEFAULT_PRINTERS) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Print profiles must be an object");
  const profiles = {};
  for (const [kind, defaults] of Object.entries(DEFAULT_PROFILES)) {
    const value = input[kind];
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Missing ${kind} profile`);
    const printer = String(value.printer || "");
    const media = String(value.media || "");
    const copies = Number(value.copies);
    if (!printers.some((item) => item.id === printer)) throw new Error(`Invalid printer for ${kind}`);
    if (!SAFE_OPTION.test(media)) throw new Error(`Invalid media for ${kind}`);
    if (!Number.isInteger(copies) || copies < 1 || copies > 20) throw new Error(`Copies must be 1–20 for ${kind}`);
    if (!["portrait", "landscape"].includes(value.orientation)) throw new Error(`Invalid orientation for ${kind}`);
    if (!["none", "fit"].includes(value.scaling)) throw new Error(`Invalid scaling for ${kind}`);
    profiles[kind] = { ...defaults, printer, media, copies, orientation: value.orientation, scaling: value.scaling };
  }
  return profiles;
}

function run(command, args, input, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString().slice(0, 2048); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString().slice(0, 2048); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

async function listQueues() {
  const output = await run("lpstat", ["-e"]);
  return output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

async function listQueueDevices() {
  const output = await run("lpstat", ["-v"]);
  const devices = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^device for ([^:]+): (.+)$/.exec(line.trim());
    if (match) devices[match[1]] = match[2];
  }
  return devices;
}

function parseMediaOptions(output) {
  const line = output.split(/\r?\n/).find((item) => /^(?:PageSize|media)\/[^:]+:/.test(item.trim()));
  if (!line) return [];
  return [...new Set(line.slice(line.indexOf(":") + 1).trim().split(/\s+/)
    .map((item) => item.replace(/^\*/, ""))
    .filter((item) => /^[A-Za-z0-9_.+/-]{1,80}$/.test(item) && !/^Custom\./i.test(item)))];
}

function parsePpdMediaOptions(output) {
  return [...new Set([...output.matchAll(/^\*PageSize\s+([^\s/:]+)(?:\/[^:]*)?:/gm)]
    .map((match) => match[1])
    .filter((item) => /^[A-Za-z0-9_.+/-]{1,80}$/.test(item) && !/^Custom\./i.test(item)))];
}

async function listQueueMedia(queue) {
  if (!/^[A-Za-z0-9_.-]+$/.test(queue) || queue === "." || queue === "..") throw new Error("Invalid CUPS queue name");
  let commandError;
  try {
    const listed = parseMediaOptions(await run("lpoptions", ["-p", queue, "-l"]));
    if (listed.length) return listed;
  } catch (error) { commandError = error; }
  try {
    const ppd = await readFile(`/etc/cups/ppd/${queue}.ppd`, "utf8");
    const listed = parsePpdMediaOptions(ppd);
    if (listed.length) return listed;
  } catch (error) {
    throw new Error(`Could not read printer sizes: ${commandError?.message || "lpoptions reported no sizes"}; PPD fallback: ${error.message}`);
  }
  throw new Error(`Could not read printer sizes: ${commandError?.message || "lpoptions and PPD reported no sizes"}`);
}

function printJobArgs(profile, queue, prepared) {
  return ["-d", queue, "-n", String(profile.copies), "-o", `media=${profile.media}`,
    "-o", `orientation-requested=${prepared || profile.orientation === "portrait" ? "3" : "4"}`,
    "-o", "sides=one-sided",
    "-o", `print-scaling=${prepared ? "none" : profile.scaling}`, "-"];
}

async function submitPdf({ pdf, profile, queue, prepared = false }) {
  if (!queue || !(await listQueues()).includes(queue)) throw new Error("Configured printer queue is unavailable");
  return run("lp", printJobArgs(profile, queue, prepared), pdf, 30000);
}

module.exports = { SETTING_KEY, DOCUMENTS, DEFAULT_PRINTERS, DEFAULT_PROFILES, validatePrinters, validateProfiles, listQueues, listQueueDevices, parseMediaOptions, parsePpdMediaOptions, listQueueMedia, printJobArgs, submitPdf };
