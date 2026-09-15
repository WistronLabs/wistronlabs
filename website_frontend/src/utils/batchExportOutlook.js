const COLUMNS = [
  ["Service Tag", null],
  ["L11 Logs TGZs", "include_l11_logs"],
  ["Support Photos", "include_support_photos"],
  ["L10 Test Folders", "include_l10_test_folders"],
];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

export function buildBatchExportOutlookContent(reviewRows) {
  const rows = reviewRows.map((row) =>
    COLUMNS.map(([, key]) =>
      key ? (row.found_types?.[key] === true ? "X" : "") : row.service_tag,
    ),
  );
  const cellStyle = "border:1px solid #d1d5db;padding:6px 10px;";
  const headers = COLUMNS.map(([label]) =>
    `<th style="${cellStyle}background-color:#f3f4f6;text-align:left;">${label}</th>`,
  ).join("");
  const body = rows.map((cells) => `<tr>${cells.map((value, index) =>
    `<td style="${cellStyle}text-align:${index === 0 ? "left" : "center"};">${escapeHtml(value)}</td>`,
  ).join("")}</tr>`).join("");

  return {
    html: `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt;"><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`,
    plainText: [COLUMNS.map(([label]) => label), ...rows]
      .map((cells) => cells.join("\t")).join("\n"),
  };
}
