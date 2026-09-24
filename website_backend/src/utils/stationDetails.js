function normalizedDetails(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return JSON.stringify(value);
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return JSON.stringify(value);
  }
}

module.exports = { normalizedDetails };
