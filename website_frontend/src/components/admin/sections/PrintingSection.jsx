import { useEffect, useMemo, useRef, useState } from "react";
import Select from "react-select";
import useApi from "../../../hooks/useApi.jsx";
import AdminActionBar from "../AdminActionBar.jsx";

const fieldClass = "mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200";
const labelClass = "block text-sm font-medium text-gray-700";
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
  { value: "fit", label: "Fit to media" },
];

const familiarSizes = {
  Letter: "US Letter (8.5 × 11 in)",
  Legal: "US Legal (8.5 × 14 in)",
  A4: "A4 (210 × 297 mm)",
  A5: "A5 (148 × 210 mm)",
  "na_letter_8.5x11in": "US Letter (8.5 × 11 in)",
  "na_legal_8.5x14in": "US Legal (8.5 × 14 in)",
  "iso_a4_210x297mm": "A4 (210 × 297 mm)",
  "iso_a5_148x210mm": "A5 (148 × 210 mm)",
};
function mediaLabel(value) {
  const points = /^w(\d+)h(\d+)$/i.exec(value);
  if (points) return `${Number((Number(points[1]) / 72).toFixed(2))} × ${Number((Number(points[2]) / 72).toFixed(2))} in (${value})`;
  return familiarSizes[value] ? `${familiarSizes[value]} (${value})` : value;
}

function PrintSelect({ id, label, value, options, onChange, placeholder, isSearchable = false, isDisabled = false }) {
  return <div className="min-w-0">
    <label htmlFor={id} className={labelClass}>{label}</label>
    <div className="mt-1.5">
      <Select
        inputId={id}
        instanceId={id}
        value={options.find((option) => option.value === value) || null}
        options={options}
        onChange={(option) => onChange(option?.value || "")}
        placeholder={placeholder}
        isSearchable={isSearchable}
        isDisabled={isDisabled}
        isClearable={false}
        styles={selectStyles}
        menuPortalTarget={typeof document === "undefined" ? undefined : document.body}
        menuPosition="fixed"
      />
    </div>
  </div>;
}

function StatusPill({ ready }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${ready
    ? "bg-emerald-100 text-emerald-800"
    : "bg-amber-100 text-amber-800"}`}>
    {ready ? "Queue installed" : "Needs queue"}
  </span>;
}

export default function PrintingSection() {
  const { getPrintSettings, getPrinterQueues, savePrintSettings } = useApi();
  const apiRef = useRef({ getPrintSettings, getPrinterQueues });
  apiRef.current = { getPrintSettings, getPrinterQueues };
  const [settings, setSettings] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [queues, setQueues] = useState([]);
  const [devices, setDevices] = useState({});
  const [mediaByQueue, setMediaByQueue] = useState({});
  const [mediaErrors, setMediaErrors] = useState({});
  const [queueError, setQueueError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    apiRef.current.getPrintSettings()
      .then((current) => {
        if (active) { setSettings(current); setBaseline(current); }
      })
      .catch((cause) => { if (active) setError(cause.body?.error || cause.message); });
    apiRef.current.getPrinterQueues()
      .then((installed) => {
        if (active) {
          setQueues(installed.queues || []);
          setDevices(installed.devices || {});
          setMediaByQueue(installed.media || {});
          setMediaErrors(installed.mediaErrors || {});
        }
      })
      .catch((cause) => { if (active) setQueueError(cause.body?.error || cause.message); });
    return () => { active = false; };
  }, []);

  const queueOptions = useMemo(() => {
    const configured = settings?.printers.map((printer) => printer.queue).filter(Boolean) || [];
    return [...new Set([...queues, ...configured])].map((queue) => ({
      value: queue,
      label: queue,
      ...(devices[queue] ? { device: devices[queue] } : {}),
    }));
  }, [queues, settings?.printers, devices]);
  const printerOptions = settings?.printers.map((printer) => ({ value: printer.id, label: printer.name || printer.id })) || [];
  const readyCount = settings?.printers.filter((printer) => printer.queue && queues.includes(printer.queue)).length || 0;
  const hasChanges = !!settings && !!baseline && JSON.stringify(settings) !== JSON.stringify(baseline);

  function updatePrinter(id, field, value) {
    setMessage("");
    setSettings((previous) => ({
      ...previous,
      printers: previous.printers.map((printer) => printer.id === id ? { ...printer, [field]: value } : printer),
    }));
  }

  function addPrinter() {
    setMessage("");
    setSettings((previous) => {
      let number = 1;
      while (previous.printers.some((printer) => printer.id === `printer_${number}`)) number += 1;
      return {
        ...previous,
        printers: [...previous.printers, { id: `printer_${number}`, name: `Printer ${number}`, queue: "" }],
      };
    });
  }

  function removePrinter(id) {
    if (Object.values(settings.profiles).some((profile) => profile.printer === id)) {
      setError("Assign this printer's document types to another printer before removing it.");
      return;
    }
    setError("");
    setMessage("");
    setSettings((previous) => ({
      ...previous,
      printers: previous.printers.filter((printer) => printer.id !== id),
    }));
  }

  function setProfile(kind, field, value) {
    setMessage("");
    setSettings((previous) => ({
      ...previous,
      profiles: { ...previous.profiles, [kind]: { ...previous.profiles[kind], [field]: value } },
    }));
  }

  function discard() {
    setSettings(baseline);
    setError("");
    setMessage("");
  }

  async function save(event) {
    event.preventDefault();
    if (!hasChanges || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await savePrintSettings({ printers: settings.printers, profiles: settings.profiles });
      setSettings(result);
      setBaseline(result);
      setMessage("Printer settings saved for this site.");
    } catch (cause) {
      setError(cause.body?.error || cause.message);
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return <section className="rounded-xl border border-gray-200 p-6 text-sm text-gray-600" role="status">
    {error || "Loading printer settings…"}
  </section>;

  return <form onSubmit={save} className="space-y-8">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Printing</h2>
        <p className="mt-1 max-w-2xl text-sm text-gray-600">
          Connect this site's installed printer queues, then choose a printer and paper settings for each document.
        </p>
      </div>
      <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700">
        {readyCount} of {settings.printers.length} queues installed
      </span>
    </header>

    <section className="space-y-4" aria-labelledby="site-printers-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="site-printers-heading" className="text-base font-semibold text-gray-900">Site printers</h3>
          <p className="mt-0.5 text-sm text-gray-600">Queues must first be installed on this site's server.</p>
        </div>
        <button type="button" onClick={addPrinter} disabled={settings.printers.length >= 30}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
          + Add printer
        </button>
      </div>

      {queueError && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Could not load installed queues: {queueError}
      </p>}
      {!queueError && queues.length === 0 && <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        No printer queues were found on this server. Install a queue before assigning it here.
      </p>}

      <div className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-3 sm:p-4">
        {settings.printers.length === 0 && <p className="py-4 text-center text-sm text-gray-500">No printers added yet.</p>}
        {settings.printers.map((printer) => {
          const ready = !!printer.queue && queues.includes(printer.queue);
          const device = devices[printer.queue];
          return <div key={printer.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 15h12v6H6v-6Z" /></svg>
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">{printer.name || "Unnamed printer"}</p>
                  <p className="text-xs text-gray-500">{printer.id}</p>
                </div>
              </div>
              <StatusPill ready={ready} />
            </div>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
              <div>
                <label htmlFor={`printer-name-${printer.id}`} className={labelClass}>Display name</label>
                <input id={`printer-name-${printer.id}`} className={fieldClass} maxLength={80} value={printer.name}
                  onChange={(event) => updatePrinter(printer.id, "name", event.target.value)} />
              </div>
              <PrintSelect id={`printer-queue-${printer.id}`} label="Installed queue" value={printer.queue}
                options={queueOptions} placeholder="Select a queue…" isSearchable
                onChange={(value) => updatePrinter(printer.id, "queue", value)} />
              <button type="button" onClick={() => removePrinter(printer.id)}
                className="h-[42px] rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:border-red-300 hover:bg-red-50 hover:text-red-700">
                Remove
              </button>
            </div>
            {device && <p className="mt-2 break-all text-xs text-gray-500">Destination: {device}</p>}
            {printer.queue && !ready && !queueError && <p className="mt-2 text-xs text-amber-800">This queue is no longer installed on the server.</p>}
          </div>;
        })}
      </div>
    </section>

    <section className="space-y-4" aria-labelledby="document-defaults-heading">
      <div>
        <h3 id="document-defaults-heading" className="text-base font-semibold text-gray-900">Document defaults</h3>
        <p className="mt-0.5 text-sm text-gray-600">These are the starting settings in the print preview. Staff can adjust copies, orientation, and scaling for a single job.</p>
      </div>
      <div className="space-y-3">
        {Object.entries(settings.documents).map(([kind, printDocument]) => {
          const profile = settings.profiles[kind];
          const assigned = settings.printers.find((printer) => printer.id === profile.printer);
          const ready = !!assigned?.queue && queues.includes(assigned.queue);
          const supportedMedia = mediaByQueue[assigned?.queue] || [];
          const mediaMissing = !!assigned?.queue && supportedMedia.length > 0 && !supportedMedia.includes(profile.media);
          const mediaOptions = supportedMedia.map((value) => ({ value, label: mediaLabel(value) }));
          if (profile.media && !supportedMedia.includes(profile.media)) {
            mediaOptions.unshift({ value: profile.media, label: `${mediaLabel(profile.media)} (not offered by queue)`, isDisabled: true });
          }
          return <article key={kind} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-semibold text-gray-900">{printDocument.name}</h4>
              <StatusPill ready={ready} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_110px]">
              <PrintSelect id={`profile-printer-${kind}`} label="Printer" value={profile.printer}
                options={printerOptions} placeholder="Select a printer…" isSearchable
                onChange={(value) => setProfile(kind, "printer", value)} />
              <PrintSelect id={`profile-media-${kind}`} label="Paper / label size" value={profile.media}
                options={mediaOptions} placeholder={assigned?.queue ? "Choose a supported size…" : "Select a queue first…"}
                isSearchable isDisabled={!ready || supportedMedia.length === 0}
                onChange={(value) => setProfile(kind, "media", value)} />
              <div>
                <label htmlFor={`profile-copies-${kind}`} className={labelClass}>Copies</label>
                <input id={`profile-copies-${kind}`} type="number" min="1" max="20" className={fieldClass}
                  value={profile.copies} onChange={(event) => setProfile(kind, "copies", Number(event.target.value))} />
              </div>
            </div>
            {mediaMissing && <p className="mt-3 text-sm text-amber-800">The current size is not offered by this queue. Choose one of its supported sizes before saving.</p>}
            {ready && supportedMedia.length === 0 && <p className="mt-3 text-sm text-amber-800">
              {mediaErrors[assigned.queue]
                ? `Could not load this queue's paper sizes: ${mediaErrors[assigned.queue]}`
                : "This queue did not report any paper sizes. Check its CUPS driver or queue configuration."}
            </p>}
            <div className="mt-4 grid gap-4 border-t border-gray-100 pt-4 sm:grid-cols-2">
              <PrintSelect id={`profile-orientation-${kind}`} label="Default orientation" value={profile.orientation}
                options={orientationOptions} onChange={(value) => setProfile(kind, "orientation", value)} />
              <PrintSelect id={`profile-scaling-${kind}`} label="Default scaling" value={profile.scaling}
                options={scalingOptions} onChange={(value) => setProfile(kind, "scaling", value)} />
            </div>
          </article>;
        })}
      </div>
    </section>

    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p>}
    <AdminActionBar onDiscard={discard} saving={busy} hasChanges={hasChanges} saveLabel="Save printer settings" />
  </form>;
}
