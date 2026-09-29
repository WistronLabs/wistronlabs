import { useEffect, useState } from "react";
import Select from "react-select";
import useTerminalApi from "../hooks/useTerminalApi";
import TerminalPanel from "./TerminalPanel";
import TerminalWorkspace from "./TerminalWorkspace";
import { button } from "./terminalControls";

export default function BiosTerminalWorkspace(props) {
  const request = useTerminalApi();
  const [sessions, setSessions] = useState([]);
  const [selectedMac, setSelectedMac] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const refresh = () => request("/bios/sessions")
      .then((data) => {
        if (active) {
          setSessions(data.bios || []);
          setError("");
        }
      })
      .catch((cause) => { if (active) setError(cause.message); });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [request]);

  const options = sessions.map((mac) => ({ value: mac, label: `BIOS ${mac.toUpperCase()}` }));
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
      <label htmlFor="bios-session-select" className="text-sm font-medium text-gray-700">BIOS serial</label>
      <Select
        inputId="bios-session-select"
        instanceId="bios-session-select"
        aria-label="BIOS serial session"
        className="min-w-56 flex-1 text-sm sm:max-w-sm"
        options={options}
        value={options.find((option) => option.value === selectedMac) || (selectedMac ? { value: selectedMac, label: `BIOS ${selectedMac.toUpperCase()}` } : null)}
        onChange={(option) => setSelectedMac(option?.value || "")}
        placeholder={sessions.length ? "Open a BIOS session…" : "No active BIOS sessions"}
        isClearable
      />
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
      <span className="text-xs text-gray-500">Run bios_serial.sh in a station to start a session.</span>
    </div>
    <div className={selectedMac ? "grid gap-3 xl:grid-cols-2" : ""}>
      <TerminalWorkspace {...props} />
      {selectedMac && <div className="flex h-[max(480px,65vh)] min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Separate BIOS session</span>
          <button className={button} onClick={() => setSelectedMac("")}>Close view</button>
        </div>
        <div className="min-h-0 flex-1"><TerminalPanel biosMac={selectedMac} request={request} onClose={() => setSelectedMac("")} /></div>
      </div>}
    </div>
  </div>;
}
