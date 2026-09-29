const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_PRINTERS, DEFAULT_PROFILES, validatePrinters, validateProfiles, parseMediaOptions, parsePpdMediaOptions, printJobArgs } = require("../src/services/printing");

test("CUPS media options expose the exact driver names for paper and labels", () => {
  assert.deepEqual(parseMediaOptions("PageSize/Media Size: A4 *Letter w144h72 Custom.WIDTHxHEIGHT\nInputSlot/Tray: *Auto Manual"),
    ["A4", "Letter", "w144h72"]);
  assert.deepEqual(parseMediaOptions("media/Media Size: *na_letter_8.5x11in iso_a4_210x297mm"),
    ["na_letter_8.5x11in", "iso_a4_210x297mm"]);
  assert.deepEqual(parsePpdMediaOptions('*PageSize w144h72/2 x 1 in: "<</PageSize[144 72]>>setpagedevice"\n*PageSize A4/A4: "..."\n*PageSize Custom.WIDTHxHEIGHT/Custom: "..."'),
    ["w144h72", "A4"]);
});

test("a site can add another Zebra queue and assign one label type to it", () => {
  const printers = validatePrinters([...DEFAULT_PRINTERS,
    { id: "zebra_2", name: "ZD421 on second print server", queue: "zebra_second" },
  ], ["zebra_second"]);
  const profiles = validateProfiles({ ...DEFAULT_PROFILES,
    rma_label: { ...DEFAULT_PROFILES.rma_label, printer: "zebra_2", copies: 2 },
  }, printers);
  assert.equal(profiles.rma_label.printer, "zebra_2");
  assert.equal(profiles.rma_label.copies, 2);
  assert.equal(profiles.system_id.printer, "zebra");
});

test("only installed queues and bounded print options are accepted", () => {
  assert.throws(() => validatePrinters([{ id: "other", name: "Other", queue: "missing" }], []), /not an installed/);
  assert.throws(() => validateProfiles({ ...DEFAULT_PROFILES,
    system_id: { ...DEFAULT_PROFILES.system_id, media: "Letter;touch /tmp/x" },
  }), /Invalid media/);
  assert.throws(() => validateProfiles({ ...DEFAULT_PROFILES,
    system_id: { ...DEFAULT_PROFILES.system_id, copies: 100 },
  }), /Copies must be/);
});

test("per-job orientation and scaling can override defaults without retaining duplex settings", () => {
  const profiles = validateProfiles({ ...DEFAULT_PROFILES,
    pallet_sheet: { ...DEFAULT_PROFILES.pallet_sheet, copies: 3, orientation: "landscape", scaling: "fit", sides: "two-sided-long-edge" },
  });
  assert.equal(profiles.pallet_sheet.copies, 3);
  assert.equal(profiles.pallet_sheet.orientation, "landscape");
  assert.equal(profiles.pallet_sheet.scaling, "fit");
  assert.equal(Object.hasOwn(profiles.pallet_sheet, "sides"), false);
});

test("a prepared PDF is not rotated or scaled a second time by CUPS", () => {
  const profile = { ...DEFAULT_PROFILES.system_id, orientation: "landscape", scaling: "fit" };
  const direct = printJobArgs(profile, "wistron_zebra", false);
  const prepared = printJobArgs(profile, "wistron_zebra", true);
  assert.ok(direct.includes("orientation-requested=4"));
  assert.ok(direct.includes("print-scaling=fit"));
  assert.ok(prepared.includes("orientation-requested=3"));
  assert.ok(prepared.includes("print-scaling=none"));
  assert.ok(prepared.includes("sides=one-sided"));
});
