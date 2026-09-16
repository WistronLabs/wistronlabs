function summarizeRunnerText(text, maxLines = 4) {
  const cleaned = String(text || "").replace(/\[hook\]\s*/gi, "").trim();
  if (!cleaned) return "";
  const lines = cleaned.split(/\r?\n/).filter(Boolean);
  const clipped = lines.slice(-maxLines);
  const suffix = lines.length > maxLines ? "\n..." : "";
  return `${clipped.join("\n")}${suffix}`;
}

export function getL11ScanDisplayStatus(status, stdout = "") {
  const rawStatus = String(status || "").toLowerCase();
  const output = String(stdout || "").toLowerCase();

  if (rawStatus === "queued") return "Queued";
  if (rawStatus === "dispatching") return "Starting";
  if (rawStatus === "unknown") return "Needs review";
  if (rawStatus === "outdated") return "Outdated";
  if (rawStatus === "running") return "Running";
  if (rawStatus === "failed") return "Failed";
  if (rawStatus === "succeeded") {
    if (
      output.includes("nothing to collect") ||
      output.includes("nothing to do") ||
      output.includes("no extracted folder tree contains")
    ) {
      return "Complete";
    }
    return "Complete";
  }
  return "Unknown";
}

export function getL11ScanSummary(stdout = "") {
  const output = String(stdout || "");
  const normalized = output.toLowerCase();

  if (!output.trim()) return "";
  if (normalized.includes("rack folder in mft not found")) return "No L11 folder was found on MFT for this rack.";
  if (
    normalized.includes("nothing to collect") ||
    normalized.includes("nothing to do") ||
    normalized.includes("no extracted folder tree contains")
  ) {
    return "No matching L11 fail logs were found for this unit.";
  }
  if (
    normalized.includes("moving tar to") ||
    normalized.includes("[hook] done.") ||
    normalized.includes("creating tar")
  ) {
    return "L11 logs were found and processed.";
  }
  return summarizeRunnerText(output);
}

export function formatL11ScanToastMessage({ status, stdout = "" }) {
  const lines = [
    "L11 Log Scan",
    `Status: ${getL11ScanDisplayStatus(status, stdout)}`,
  ];
  const output = getL11ScanSummary(stdout);
  return output ? `${lines.join("\n")}\n\n${output}` : lines.join("\n");
}

