export function allowedNextLocations(currentLocation, locations) {
  if (!locations.length) return [];
  switch (currentLocation) {
    case "Received":
      return locations.filter((l) => l.name === "In Debug - Wistron");
    case "In Debug - Wistron":
      return locations.filter((l) =>
        [
          "In L10",
          "Pending Parts",
          "Pending L11 Logs",
          "In Debug - Wistron",
          "RMA VID",
          "RMA PID",
          "RMA CID",
        ].includes(l.name),
      );
    case "Pending Parts":
      return locations.filter((l) =>
        ["Pending Parts", "In Debug - Wistron"].includes(l.name),
      );
    case "Pending L11 Logs":
      return locations.filter((l) =>
        [
          "In Debug - Wistron",
          "RMA VID",
          "RMA PID",
          "RMA CID",
        ].includes(l.name),
      );
    case "In L10":
      return locations.filter((l) =>
        [
          "In Debug - Wistron",
          "RMA VID",
          "RMA PID",
          "RMA CID",
          "Sent to L11",
        ].includes(l.name),
      );
    default:
      return [];
  }
}
