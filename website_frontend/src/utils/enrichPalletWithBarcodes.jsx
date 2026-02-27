// utils/enrichPalletWithBarcodes.js
import { generateBarcodePNG } from "./generateBarcode";

export const enrichPalletWithBarcodes = (pallet) => {
  const safePalletNumber = pallet.pallet_number?.trim() || "MISSING-PALLET";
  const safeDPN = pallet.dpn?.trim() || "MISSING-DPN";
  const safeReleased = pallet.date_released?.trim() || "MISSING-RELEASED";
  return {
    ...pallet,
    pallet_number_barcode: generateBarcodePNG(safePalletNumber),
    pallet_dpn_barcode: generateBarcodePNG(safeDPN),
    pallet_released_barcode: generateBarcodePNG(safeReleased),
    systems: pallet.systems.map((sys) => {
      const safeServiceTag = sys.service_tag?.trim() || "MISSING-ST";
      const safePPID = sys.ppid?.trim() || "MISSING-PPID";
      const safeDOA = (sys.doa_number || "").trim() || "MISSING-DOA";

      return {
        ...sys,
        service_tag: safeServiceTag,
        ppid: safePPID,
        doa_number: (sys.doa_number || "").trim(),
        service_tag_barcode: generateBarcodePNG(safeServiceTag),
        ppid_barcode: generateBarcodePNG(safePPID),
        doa_number_barcode: generateBarcodePNG(safeDOA),
      };
    }),
  };
};
