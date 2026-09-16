import { useEffect, useRef, useState } from "react";
import useApi from "./useApi";

export default function useMrbApprovals(serviceTag, receivedAt) {
  const api = useApi();
  const apiRef = useRef(api);
  apiRef.current = api;
  const context = `${serviceTag}:${receivedAt || ""}`;
  const contextRef = useRef(context);
  contextRef.current = context;
  const [state, setState] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setState({ context, loading: true });
    apiRef.current.getMrbApprovals(serviceTag).then((data) => {
      if (active) setState({ context, data });
    }).catch((error) => {
      if (active) setState({ context, error: error.body?.error || error.message });
    });
    return () => { active = false; };
  }, [context, serviceTag]);

  async function upload(file) {
    if (!file || busy) return;
    setBusy(true);
    setState((previous) => ({ ...previous, error: "" }));
    try {
      const result = await apiRef.current.uploadMrbApproval([serviceTag], file);
      const failed = result.results?.find((row) => row.status === "failed");
      if (failed) throw new Error(failed.message);
      const data = await apiRef.current.getMrbApprovals(serviceTag);
      if (contextRef.current === context) setState({ context, data });
    } catch (error) {
      if (contextRef.current === context) setState((previous) => ({ ...previous, error: error.body?.error || error.message }));
    } finally { setBusy(false); }
  }

  const current = state.context === context ? state : {};
  return { files: current.data?.files || [], found: !!current.data?.found,
    loading: state.context !== context || !!current.loading, loaded: !!current.data,
    error: current.error, busy, upload };
}
