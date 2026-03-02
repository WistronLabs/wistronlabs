export const buildGroupedPartOptions = (parts = []) => {
  const byCat = new Map();

  parts.forEach((p) => {
    const cat = p.category_name || "Uncategorized";
    const dpn = p.dpn || "";
    const name = p.name || "";
    const displayLabel = `${name} ${cat}${dpn ? ` [${dpn}]` : ""}`;

    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push({
      value: p.id,
      label: displayLabel,
      name,
      dpn,
      category_name: cat,
      part_category_id: p.part_category_id,
    });
  });

  return Array.from(byCat.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, options]) => ({
      label,
      options: options.sort((a, b) => a.label.localeCompare(b.label)),
    }));
};

export const filterPartOption = (option, rawInput) => {
  if (!rawInput) return true;
  const term = rawInput.toLowerCase();

  const label = (option?.label || "").toLowerCase();
  const cat = (
    option?.data?.category_name ??
    option?.category_name ??
    ""
  ).toLowerCase();
  const dpn = (option?.data?.dpn ?? option?.dpn ?? "").toLowerCase();

  return label.includes(term) || cat.includes(term) || dpn.includes(term);
};
