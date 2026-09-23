import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { AuthContext } from '../../../context/AuthContext';

const base = `${import.meta.env.VITE_BACKEND_URL}/auth`;

export default function AccountAccessSection({ users }) {
  const { token } = useContext(AuthContext);
  const [kind, setKind] = useState('invite');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [codes, setCodes] = useState([]);
  const [history, setHistory] = useState(false);
  const [shown, setShown] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [temporary, setTemporary] = useState(null);
  const [now, setNow] = useState(Date.now());

  const config = useMemo(() => ({ withCredentials: true, headers: { Authorization: `Bearer ${token}` } }), [token]);
  const load = useCallback(async () => {
    if (!token) return;
    try { setCodes((await axios.get(`${base}/codes`, config)).data); }
    catch (reason) { setError(reason.response?.data?.error || 'Unable to load codes'); }
  }, [token, config]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  async function create(event) {
    event.preventDefault();
    setBusy(true); setError(''); setShown(null);
    try {
      const { data } = await axios.post(`${base}/codes`, { kind, email, displayName }, config);
      setShown({ kind, email, code: data.code, expiresAt: data.expires_at });
      setEmail(''); setDisplayName('');
      await load();
    } catch (reason) { setError(reason.response?.data?.error || 'Unable to create code'); }
    finally { setBusy(false); }
  }

  async function revoke(id) {
    setBusy(true); setError('');
    try { await axios.post(`${base}/codes/${id}/revoke`, {}, config); await load(); }
    catch (reason) { setError(reason.response?.data?.error || 'Unable to revoke code'); }
    finally { setBusy(false); }
  }

  async function resetPassword() {
    if (!selected) return;
    setBusy(true); setError(''); setTemporary(null);
    try {
      const { data } = await axios.post(`${base}/users/${encodeURIComponent(selected)}/reset-password`, {}, config);
      setTemporary({ email: selected, password: data.temporaryPassword, expiresAt: data.expiresAt });
    } catch (reason) { setError(reason.response?.data?.error || 'Unable to reset password'); }
    finally { setBusy(false); }
  }

  const withStatus = codes.map((code) => ({ ...code, status: code.status === 'active' &&
    new Date(code.expires_at).getTime() <= now ? 'expired' : code.status }));
  const visible = history ? withStatus : withStatus.filter((code) => code.status === 'active');
  const remain = (date) => {
    const minutes = Math.max(0, Math.ceil((new Date(date).getTime() - now) / 60000));
    return minutes >= 1440 ? `${Math.ceil(minutes / 1440)} days` : `${minutes} min`;
  };

  return <section className="space-y-6 rounded-xl bg-white p-5 shadow">
    <h2 className="text-xl font-semibold">Invitations and Account Recovery</h2>
    <p className="text-sm text-gray-600">Codes are shown once. Share each code with its named recipient through your usual work channel.</p>
    <form onSubmit={create} className="grid gap-3 md:grid-cols-4">
      <label className="text-sm">Code type<select value={kind} onChange={(event) => setKind(event.target.value)} className="mt-1 w-full rounded border p-2">
        <option value="invite">New user invitation</option>
        <option value="enrollment">Existing user enrollment</option>
        <option value="recovery">Lost passkey recovery</option>
      </select></label>
      <label className="text-sm">Recipient email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      <label className="text-sm">Recipient name<input required={kind === 'invite'} value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      <button disabled={busy} className="self-end rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-60">Create Code</button>
    </form>
    {shown && <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
      <strong>{shown.kind} code for {shown.email}:</strong> <code className="break-all select-all">{shown.code}</code>
      <p>Expires {new Date(shown.expiresAt).toLocaleString()}. Copy it now; it will not be shown again.</p>
      <button type="button" onClick={() => setShown(null)} className="mt-2 text-blue-700 underline">Hide code</button>
    </div>}
    <div className="flex items-center justify-between">
      <h3 className="font-semibold">{history ? 'Code history' : 'Pending codes'}</h3>
      <label className="text-sm"><input type="checkbox" checked={history} onChange={(event) => setHistory(event.target.checked)} /> Show used, expired, and revoked</label>
    </div>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b">
      <th className="p-2">Recipient</th><th className="p-2">Type</th><th className="p-2">Created by</th>
      <th className="p-2">Expires</th><th className="p-2">TTL</th><th className="p-2">Status</th><th className="p-2">Action</th>
    </tr></thead><tbody>{visible.map((code) => <tr key={code.id} className="border-b">
      <td className="p-2">{code.display_name || '—'}<br />{code.email}</td><td className="p-2">{code.kind}</td>
      <td className="p-2">{code.created_by_name || 'Bootstrap'}</td>
      <td className="p-2">{new Date(code.expires_at).toLocaleString()}</td>
      <td className="p-2">{code.status === 'active' ? remain(code.expires_at) : '—'}</td>
      <td className="p-2">{code.status}</td>
      <td className="p-2">{code.status === 'active' && <button disabled={busy} type="button" onClick={() => revoke(code.id)} className="text-red-700 underline">Revoke</button>}</td>
    </tr>)}</tbody></table>{!visible.length && <p className="p-3 text-gray-600">No codes to show.</p>}</div>
    <div className="border-t pt-4">
      <h3 className="mb-2 font-semibold">Temporary Password Reset</h3>
      <p className="mb-3 text-sm text-gray-600">Resetting a password ends existing sessions. The temporary password expires in 48 hours.</p>
      <div className="flex flex-wrap gap-2"><select value={selected} onChange={(event) => setSelected(event.target.value)} className="rounded border p-2">
        <option value="">Select a user</option>{users.filter((user) => user.enabled).map((user) => <option key={user.id} value={user.username}>{user.username}</option>)}
      </select><button type="button" disabled={!selected || busy} onClick={resetPassword} className="rounded bg-amber-700 px-4 py-2 text-white disabled:opacity-60">Generate Temporary Password</button></div>
      {temporary && <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
        <strong>Temporary password for {temporary.email}:</strong> <code className="break-all select-all">{temporary.password}</code>
        <p>Expires {new Date(temporary.expiresAt).toLocaleString()}. Copy it now; it will not be shown again.</p>
        <button type="button" onClick={() => setTemporary(null)} className="mt-2 text-blue-700 underline">Hide password</button>
      </div>}
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
