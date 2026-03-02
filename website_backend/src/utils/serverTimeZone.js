function getServerTimeZone() {
  if (process.env.LOCATION === "TSS") return "America/Chicago";
  if (process.env.LOCATION === "FRK") return "America/New_York";
  return "UTC";
}

module.exports = { getServerTimeZone };
