export function allowedNextLocations(
  currentLocation,
  locations,
  repairsAllowed,
) {
  if (!locations.length) return [];
  switch (currentLocation) {
    case "Received":
      return locations.filter((l) => l.name === "In Debug - Wistron");
    case "In Debug - Wistron":
      return repairsAllowed
        ? locations.filter((l) =>
            [
              "In L10",
              "Pending Parts",
              "Pending L11 Logs",
              "In Debug - Wistron",
              "RMA VID",
              "RMA PID",
              "Pending MRB",
            ].includes(l.name),
          )
        : locations.filter((l) =>
            [
              "In L10",
              "In Debug - Wistron",
              "Pending L11 Logs",
              "RMA VID",
              "RMA PID",
              "Pending MRB",
              "Sent for Dell Repair",
            ].includes(l.name),
          );
    case "Pending Parts":
      return locations.filter((l) =>
        ["Pending Parts", "In Debug - Wistron"].includes(l.name),
      );
    case "Pending MRB":
      return locations.filter((l) =>
        ["Pending MRB", "In Debug - Wistron", "RMA CID"].includes(l.name),
      );
    case "Pending L11 Logs":
      return locations.filter((l) =>
        [
          "In Debug - Wistron",
          //"RMA VID",
          "RMA PID",
          //"RMA CID",
        ].includes(l.name),
      );
    case "In L10":
      return repairsAllowed
        ? locations.filter((l) =>
            [
              "In Debug - Wistron",
              "Pending MRB",
              "Pending L11 Logs",
              "RMA VID",
              "RMA PID",
              "Sent to L11",
            ].includes(l.name),
          )
        : locations.filter((l) =>
            [
              "In Debug - Wistron",
              "Pending MRB",
              "Pending L11 Logs",
              "RMA VID",
              "RMA PID",
              "Sent to L11",
              "Sent for Dell Repair",
            ].includes(l.name),
          );
    default:
      return [];
  }
}
