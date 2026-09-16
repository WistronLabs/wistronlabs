import { useEffect, useRef, useState } from "react";
import useApi from "./useApi";
export const isActiveScan = (job) => ["queued", "dispatching", "running"].includes(job?.status);

export default function useL11ScanJobs(serviceTag, enabled, onComplete) {
  const apiRef = useRef(null);
  apiRef.current = useApi();
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const [snapshot, setSnapshot] = useState({});
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  const refresh = () => setNonce((value) => value + 1);
  useEffect(() => {
    if (!enabled) return;
    let canceled = false, timer;
    const seen = new Map();
    async function poll() {
      try {
        const result = serviceTag ? await apiRef.current.getSystemL11Scans(serviceTag) : await apiRef.current.getBatchL11Scans();
        if (canceled) return;
        setSnapshot({serviceTag, jobs: result.data}); setError("");
        let completed = false;
        for (const job of result.data) {
          if ((isActiveScan(seen.get(job.job_id)) && !isActiveScan(job))
            || (!seen.has(job.job_id) && job.current && ["succeeded", "failed"].includes(job.status))) completed = true;
          seen.set(job.job_id, job);
        }
        if (completed) completeRef.current?.();
      } catch (err) { if (!canceled) setError(err.body?.error || err.message); }
      finally { if (!canceled) timer = setTimeout(poll, 2500); }
    }
    poll();
    return () => { canceled = true; clearTimeout(timer); };
  }, [serviceTag, enabled, nonce]);
  return { jobs: enabled && snapshot.serviceTag === serviceTag ? snapshot.jobs || [] : [], error: enabled ? error : "", refresh };
}
