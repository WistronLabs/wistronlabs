// utils/enrichPalletWithBarcodes.js
import { generateBarcodePNG } from "./generateBarcode";

export const enrichPalletWithBarcodes = (pallet) => {
  const safeDOA = pallet.doa_number?.trim() || "MISSING-DOA";
  const safePalletNumber = pallet.pallet_number?.trim() || "MISSING-PALLET";
  const safeDPN = pallet.dpn?.trim() || "MISSING-DPN";
  const safeReleased = pallet.date_released?.trim() || "MISSING-RELEASED";
  return {
    ...pallet,
    pallet_doa_barcode: generateBarcodePNG(safeDOA),
    pallet_number_barcode: generateBarcodePNG(safePalletNumber),
    pallet_dpn_barcode: generateBarcodePNG(safeDPN),
    pallet_released_barcode: generateBarcodePNG(safeReleased),
    systems: pallet.systems.map((sys) => {
      const safeServiceTag = sys.service_tag?.trim() || "MISSING-ST";
      const safePPID = sys.ppid?.trim() || "MISSING-PPID";

      return {
        ...sys,
        service_tag: safeServiceTag,
        ppid: safePPID,
        service_tag_barcode: generateBarcodePNG(safeServiceTag),
        ppid_barcode: generateBarcodePNG(safePPID),
      };
    }),
  };
};
