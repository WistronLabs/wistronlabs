const UNASSIGNED_COLOR = "#9ca3af";

function sortNames(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function customerChartColors(names) {
  const families = new Map();
  const colors = { Unassigned: UNASSIGNED_COLOR };

  for (const name of new Set(names.map((value) => String(value || "").trim()).filter(Boolean))) {
    if (name === "Unassigned") continue;
    const base = name.replace(/\s+\d+$/, "");
    const family = base.split(/\s+/)[0].toLowerCase();
    const baseKey = base.toLowerCase();
    if (!families.has(family)) families.set(family, new Map());
    const bases = families.get(family);
    if (!bases.has(baseKey)) bases.set(baseKey, []);
    bases.get(baseKey).push(name);
  }

  const familyKeys = [...families.keys()].sort(sortNames);
  familyKeys.forEach((family, familyIndex) => {
    const bases = families.get(family);
    const baseKeys = [...bases.keys()].sort(sortNames);
    const familyHue = (210 + familyIndex * 360 / familyKeys.length) % 360;
    const familySpan = Math.min(38, 360 / familyKeys.length * 0.45);

    baseKeys.forEach((baseKey, baseIndex) => {
      const baseOffset = baseKeys.length === 1
        ? 0
        : (baseIndex / (baseKeys.length - 1) - 0.5) * familySpan;
      const variants = bases.get(baseKey).sort(sortNames);

      variants.forEach((name, variantIndex) => {
        const shadeSteps = [-7, 7, -14, 14, 0, -21, 21];
        const hueSteps = [-3, 3, -6, 6, 0, -9, 9];
        const shade = variants.length === 1 ? 0 : shadeSteps[variantIndex % shadeSteps.length];
        const hueShift = variants.length === 1 ? 0 : hueSteps[variantIndex % hueSteps.length];
        const hue = Math.round((familyHue + baseOffset + hueShift + 360) % 360);
        const lightness = 50 + shade;
        colors[name] = `hsl(${hue} 68% ${lightness}%)`;
      });
    });
  });

  return colors;
}
