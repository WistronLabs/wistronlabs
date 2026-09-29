import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Select from "react-select";
import useApi from "../hooks/useApi.jsx";
import { readPrintPreview } from "../utils/printPreview.js";
import { mediaSizePoints, preparePrintPdf } from "../utils/preparePrintPdf.js";

const fieldClass = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200";
const selectStyles = {
  control: (base, state) => ({
    ...base,
    minHeight: 42,
    borderRadius: 8,
    borderColor: state.isFocused ? "#3b82f6" : "#d1d5db",
    boxShadow: state.isFocused ? "0 0 0 2px #bfdbfe" : "none",
    "&:hover": { borderColor: "#60a5fa" },
  }),
  menuPortal: (base) => ({ ...base, zIndex: 10050 }),
};
const orientationOptions = [
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
];
const scalingOptions = [
  { value: "none", label: "Actual size" },
  { value: "fit", label: "Fit to paper / label" },
];

function PrintOptionSelect({ id, label, value, options, onChange }) {
  return <div>
    <label htmlFor={id} className="block text-sm font-medium text-gray-700">{label}</label>
    <div className="mt-1.5">
      <Select
        inputId={id}
        instanceId={id}
        value={options.find((option) => option.value === value)}
        options={options}
        onChange={(option) => onChange(option.value)}
        isSearchable={false}
        styles={selectStyles}
        menuPortalTarget={typeof window === "undefined" ? undefined : window.document.body}
        menuPosition="fixed"
      />
    </div>
  </div>;
}

function PrinterIcon({ className = "h-5 w-5" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 15h12v6H6v-6Z" />
  </svg>;
}

export default function PrintPreviewPage() {
  const { id } = useParams();
  const { getPrintSettings, submitPrintJob } = useApi();
  const getPrintSettingsRef = useRef(getPrintSettings);
  getPrintSettingsRef.current = getPrintSettings;
  const [document, setDocument] = useState(null);
  const [settings, setSettings] = useState(null);
  const [copies, setCopies] = useState(1);
  const [orientation, setOrientation] = useState("portrait");
  const [scaling, setScaling] = useState("none");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [previewBlob, setPreviewBlob] = useState(null);
  const [previewKey, setPreviewKey] = useState("");
  const [previewError, setPreviewError] = useState("");
  const layoutKey = document && settings ? `${document.id}:${settings.profiles[document.kind].media}:${orientation}:${scaling}` : "";
  const previewReady = !!previewBlob && previewKey === layoutKey;
  const pdfUrl = useMemo(() => previewBlob ? URL.createObjectURL(previewBlob) : null, [previewBlob]);

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);
  useEffect(() => {
    let active = true;
    Promise.all([readPrintPreview(id), getPrintSettingsRef.current()]).then(([record, config]) => {
      if (!active) return;
      if (!record) { setError("This preview expired. Generate the PDF again."); return; }
      setDocument(record);
      setSettings(config);
      setCopies(config.profiles[record.kind]?.copies || 1);
      setOrientation(config.profiles[record.kind]?.orientation || "portrait");
      setScaling(config.profiles[record.kind]?.scaling || "none");
    }).catch((cause) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    if (!document || !settings) return;
    let active = true;
    setPreviewBlob(null);
    setPreviewKey("");
    setPreviewError("");
    setFrameReady(false);
    preparePrintPdf(document.blob, {
      media: settings.profiles[document.kind].media,
      orientation,
      scaling,
    }).then((result) => {
      if (active) {
        setPreviewBlob(result.blob);
        setPreviewKey(layoutKey);
      }
    }).catch((cause) => {
      if (active) setPreviewError(cause.message);
    });
    return () => { active = false; };
  }, [document, settings, orientation, scaling, layoutKey]);

  async function printServer() {
    if (!previewReady) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await submitPrintJob(previewBlob, document.kind, { copies: Number(copies), orientation, scaling, prepared: true });
      setMessage(`Sent to ${result.queue}. ${result.message}`);
    } catch (cause) { setError(cause.body?.error || cause.message); }
    finally { setBusy(false); }
  }

  function savePdf() {
    if (!previewReady) return;
    const anchor = window.document.createElement("a");
    anchor.href = pdfUrl;
    anchor.download = `${String(document.title || "print").replace(/[^a-z0-9_-]+/gi, "-")}.pdf`;
    anchor.click();
  }

  if (!document || !settings) return <main className="mx-auto mt-10 w-11/12 max-w-screen-xl rounded-2xl bg-white p-8 text-sm text-gray-600 shadow-lg" role="status">
    {error || "Preparing print preview…"}
  </main>;
  const profile = settings.profiles[document.kind];
  const printer = settings.printers.find((item) => item.id === profile.printer);
  const queue = printer?.queue;
  const hasChanges = Number(copies) !== profile.copies || orientation !== profile.orientation || scaling !== profile.scaling;
  const mediaSize = mediaSizePoints(profile.media);
  const sizeLabel = mediaSize
    ? `${Number((mediaSize[0] / 72).toFixed(2))} × ${Number((mediaSize[1] / 72).toFixed(2))} in`
    : "Size unavailable";
  const copiesValid = Number.isInteger(Number(copies)) && Number(copies) >= 1 && Number(copies) <= 20;
  const typeName = settings.documents[document.kind]?.name || "Document";
  const titleSuffix = {
    system_id: "System ID",
    rma_label: "RMA Label",
    l10_pass: "L10 Pass",
    pending_parts: "Pending Parts",
    pallet_sheet: "Pallet Paper",
  }[document.kind];
  const title = document.title || typeName;
  const displayTitle = titleSuffix && title.toLowerCase().endsWith(` ${titleSuffix.toLowerCase()}`)
    ? title.slice(0, -titleSuffix.length).trim()
    : title;

  return <main className="mx-auto mt-6 w-11/12 max-w-screen-2xl space-y-5 sm:mt-10">
    <header className="px-1 pt-1">
      <h1 className="text-2xl leading-tight sm:text-3xl">
        <span className="whitespace-nowrap font-medium tracking-tight text-gray-500">PRINT PREVIEW - </span>
        <span className="break-words font-bold tracking-tight text-gray-900">{displayTitle}</span>
      </h1>
      <span className="mt-2 inline-flex rounded-md bg-gray-200 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-gray-700">{typeName}</span>
    </header>

    <div className="grid items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="space-y-4 lg:sticky lg:top-6">
        <section className="rounded-2xl bg-white p-5 shadow-lg" aria-labelledby="print-settings-heading">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 id="print-settings-heading" className="text-base font-semibold text-gray-900">Print Options</h2>
            </div>
            <button type="button" disabled={!hasChanges} onClick={() => {
              setCopies(profile.copies);
              setOrientation(profile.orientation);
              setScaling(profile.scaling);
              setMessage("");
            }} className="shrink-0 text-xs font-medium text-blue-700 hover:text-blue-800 disabled:cursor-not-allowed disabled:text-gray-400">
              Reset
            </button>
          </div>

          <div className="mt-5 flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><PrinterIcon /></span>
            <div className="min-w-0">
              <p className="text-xs text-gray-500">Site printer</p>
              <p className="truncate text-sm font-semibold text-gray-900">{printer?.name || "No printer assigned"}</p>
              <p className="truncate text-xs text-gray-500">{queue || "Queue not configured"}</p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <label htmlFor="print-copies" className="block text-sm font-medium text-gray-700">Copies</label>
              <input id="print-copies" type="number" min="1" max="20" value={copies}
                onChange={(event) => { setCopies(event.target.value); setMessage(""); }} className={`mt-1.5 ${fieldClass}`} />
              {!copiesValid && <p className="mt-1 text-xs text-red-700">Enter 1 to 20 copies.</p>}
            </div>
            <PrintOptionSelect id="print-orientation" label="Orientation" value={orientation} options={orientationOptions}
              onChange={(value) => { setOrientation(value); setMessage(""); }} />
            <PrintOptionSelect id="print-scaling" label="Scaling" value={scaling} options={scalingOptions}
              onChange={(value) => { setScaling(value); setMessage(""); }} />
          </div>

          {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">{error}</p>}
          {previewError && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">{previewError}</p>}
          {message && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">{message}</p>}
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-lg" aria-label="Print actions">
          <button type="button" onClick={printServer} disabled={busy || !previewReady || !queue || !copiesValid}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
            <PrinterIcon className="h-4 w-4" />{busy ? "Sending…" : "Print through server"}
          </button>
          <button type="button" disabled={!previewReady || !frameReady}
            onClick={() => window.document.getElementById("print-pdf-frame")?.contentWindow?.print()}
            className="mt-2.5 w-full rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-800 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50">
            System print dialog
          </button>
          <button type="button" onClick={savePdf} disabled={!previewReady}
            className="mt-2.5 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
            Save PDF
          </button>
        </section>
      </aside>

      <section className="min-w-0 overflow-hidden rounded-2xl bg-white shadow-lg" aria-labelledby="document-preview-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-4">
          <div>
            <h2 id="document-preview-heading" className="text-base font-semibold text-gray-900">Document preview</h2>
            <span className="mt-1.5 inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">{sizeLabel}</span>
          </div>
        </div>
        {previewReady && pdfUrl
          ? <iframe key={pdfUrl} id="print-pdf-frame" title="PDF preview" src={pdfUrl} onLoad={() => setFrameReady(true)} className="h-[70vh] min-h-[500px] w-full border-0 bg-gray-50" />
          : <div className="flex h-[70vh] min-h-[500px] items-center justify-center bg-gray-50 px-6 text-center text-sm text-gray-600" role="status">
            {previewError || "Preparing the selected layout…"}
          </div>}
      </section>
    </div>
  </main>;
}
