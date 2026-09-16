import { useEffect, useRef, useState } from "react";
import useApi from "../hooks/useApi";

export const MRB_APPROVAL_ACCEPT = ".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.msg,.eml";

export default function MrbApprovalPanel({ serviceTag, canUpload, refreshKey, onChange }) {
  const api = useApi();
  const apiRef = useRef(api);
  apiRef.current = api;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [data, setData] = useState({ files: [], found: false });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);
  const input = useRef(null);

  useEffect(() => {
    let active = true;
    setData({ files: [], found: false });
    onChangeRef.current?.(false);
    apiRef.current.getMrbApprovals(serviceTag).then((result) => {
      if (!active) return;
      setData(result);
      setError("");
      onChangeRef.current?.(result.found);
    }).catch((err) => { if (active) setError(err.body?.error || err.message); });
    return () => { active = false; };
  }, [serviceTag, refreshKey, nonce]);

  async function upload(file) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiRef.current.uploadMrbApproval([serviceTag], file);
      const failed = result.results?.find((row) => row.status === "failed");
      if (failed) throw new Error(failed.message);
      setNonce((value) => value + 1);
    } catch (err) { setError(err.body?.error || err.message); }
    finally { setBusy(false); }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-gray-800">MRB Approvals</h3>
        {canUpload && <button type="button" disabled={busy || data.found} onClick={() => input.current?.click()}
          className="rounded bg-sky-600 px-3 py-2 text-sm text-white hover:bg-sky-700 disabled:opacity-50">
          {busy ? "Uploading…" : "Upload MRB Approval"}
        </button>}
      </div>
      <p className={`text-sm ${data.found ? "text-green-700" : "text-amber-800"}`}>
        {data.found ? "Approval is available for this Received cycle." : "Upload approval after the latest Received event before moving to RMA CID."}
      </p>
      <p className="text-xs text-gray-500">Accepted: images, PDF, Outlook .msg or .eml.</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {data.files.map((file) => <div key={file.name} className="text-sm break-all">
        <a className="text-blue-700 underline" href={`${import.meta.env.VITE_BACKEND_URL}/systems/${encodeURIComponent(serviceTag)}/mrb-approvals/file?name=${encodeURIComponent(file.name)}`}>{file.name}</a>
        {!file.current && <span className="ml-2 text-gray-500">Previous Received cycle</span>}
      </div>)}
      <input ref={input} type="file" accept={MRB_APPROVAL_ACCEPT} className="hidden" onChange={(event) => {
        upload(event.target.files?.[0]); event.target.value = "";
      }} />
    </section>
  );
}
