import { mediaSizePoints } from "./preparePrintPdf.js";

export function matchPrintMedia(current, supported) {
  if (supported.includes(current)) return current;
  const size = mediaSizePoints(current);
  if (!size) return null;
  return supported.find((candidate) => {
    const candidateSize = mediaSizePoints(candidate);
    return candidateSize && Math.abs(candidateSize[0] - size[0]) < 2 && Math.abs(candidateSize[1] - size[1]) < 2;
  }) || null;
}
