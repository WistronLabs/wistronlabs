export function locationColor(name) {
  if (["Sent to L11", "Sent for Dell Repair", "RMA CID", "RMA VID", "RMA PID"].includes(name))
    return "border-green-200 bg-green-50 text-green-800";
  if (["Received", "In Debug - Wistron", "In L10"].includes(name))
    return "border-red-200 bg-red-50 text-red-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
}
