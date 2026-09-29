import { degrees, PDFDocument, rgb } from "pdf-lib";

const namedMedia = {
  Letter: [612, 792],
  Legal: [612, 1008],
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
};

export function mediaSizePoints(media) {
  if (namedMedia[media]) return namedMedia[media];

  const zebra = /^w(\d+)h(\d+)$/i.exec(media);
  if (zebra) return [Number(zebra[1]), Number(zebra[2])];

  const custom = /^Custom\.(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(in|mm|cm)?$/i.exec(media);
  if (custom) {
    const factor = { in: 72, mm: 72 / 25.4, cm: 72 / 2.54 }[custom[3]?.toLowerCase() || "in"];
    return [Number(custom[1]) * factor, Number(custom[2]) * factor];
  }

  const ipp = /^(?:na|iso|om)_[^_]+_(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(in|mm)$/i.exec(media);
  if (ipp) {
    const factor = ipp[3].toLowerCase() === "in" ? 72 : 72 / 25.4;
    return [Number(ipp[1]) * factor, Number(ipp[2]) * factor];
  }

  return null;
}

export async function preparePrintPdf(blob, { media, orientation, scaling }) {
  const mediaSize = mediaSizePoints(media);
  if (!mediaSize) throw new Error(`Cannot preview the printer size ${media}. Choose a standard size in Admin → Printing.`);
  if (!["portrait", "landscape"].includes(orientation) || !["none", "fit"].includes(scaling)) {
    throw new Error("Invalid print preview settings.");
  }

  const bytes = await blob.arrayBuffer();
  const source = await PDFDocument.load(bytes);
  const output = await PDFDocument.create();
  const sourcePages = source.getPages();
  const embeddedPages = await output.embedPdf(bytes, sourcePages.map((_, index) => index));
  const [paperWidth, paperHeight] = mediaSize;
  const scales = [];

  sourcePages.forEach((sourcePage, index) => {
    const pageWidth = sourcePage.getWidth();
    const pageHeight = sourcePage.getHeight();
    const rotated = orientation === "landscape";
    const contentWidth = rotated ? pageHeight : pageWidth;
    const contentHeight = rotated ? pageWidth : pageHeight;
    const scale = scaling === "fit" ? Math.min(paperWidth / contentWidth, paperHeight / contentHeight) : 1;
    scales.push(scale);
    const page = output.addPage([paperWidth, paperHeight]);
    page.drawRectangle({ x: 0, y: 0, width: paperWidth, height: paperHeight, color: rgb(1, 1, 1) });

    if (rotated) {
      page.drawPage(embeddedPages[index], {
        x: (paperWidth + pageHeight * scale) / 2,
        y: (paperHeight - pageWidth * scale) / 2,
        xScale: scale,
        yScale: scale,
        rotate: degrees(90),
      });
    } else {
      page.drawPage(embeddedPages[index], {
        x: (paperWidth - pageWidth * scale) / 2,
        y: (paperHeight - pageHeight * scale) / 2,
        xScale: scale,
        yScale: scale,
      });
    }
  });

  return {
    blob: new Blob([await output.save()], { type: "application/pdf" }),
    firstPageScale: scales[0] ?? 1,
  };
}
