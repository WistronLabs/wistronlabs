import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Select from 'react-select';
import { AuthContext } from '../../../context/AuthContext';

const base = `${import.meta.env.VITE_BACKEND_URL}/auth`;
const nonInteractiveUsers = new Set(['deleted_user@example.com', 'system']);

const codeTypes = [
  { value: 'invite', label: 'New user invitation' },
  { value: 'enrollment', label: 'Existing user enrollment' },
  { value: 'recovery', label: 'Lost passkey recovery' },
];

const descriptions = {
  invite: 'For someone who does not have an account yet.',
  enrollment: 'For an existing account without a passkey. The user sets a new password and enrolls one.',
  recovery: 'For an existing account that needs a new passkey. Creating this code ends its sessions.',
};

const statusStyles = {
  active: 'border-amber-200 bg-amber-50 text-amber-800',
  redeemed: 'border-green-200 bg-green-50 text-green-800',
  expired: 'border-gray-200 bg-gray-100 text-gray-700',
  revoked: 'border-red-200 bg-red-50 text-red-700',
};

const selectStyles = {
  control: (baseStyle, state) => ({
    ...baseStyle,
    minHeight: 42,
    borderRadius: 8,
    borderColor: state.isFocused ? '#3b82f6' : '#d1d5db',
    boxShadow: state.isFocused ? '0 0 0 2px #bfdbfe' : 'none',
    '&:hover': { borderColor: '#60a5fa' },
  }),
  menu: (baseStyle) => ({ ...baseStyle, zIndex: 20 }),
};

const fieldClass = 'mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200';

function SecretResult({ title, value, expiresAt, copied, onCopy, onHide }) {
  return <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h4 className="text-sm font-semibold text-amber-950">{title}</h4>
        <p className="mt-0.5 text-xs text-amber-800">Copy it now. It will not appear here again after you hide it.</p>
      </div>
      <button type="button" onClick={onHide} className="text-xs font-medium text-amber-900 underline underline-offset-2 hover:text-amber-700">Hide</button>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 select-all break-all rounded-lg border border-amber-200 bg-white px-3 py-2.5 text-sm text-gray-900">{value}</code>
      <button type="button" onClick={onCopy} className="rounded-lg border border-amber-300 bg-white px-3 py-2.5 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
    <p className="mt-2 text-xs text-amber-900">Expires {new Date(expiresAt).toLocaleString()}</p>
  </div>;
}

export default function AccountAccessSection({ users = [] }) {
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
  const [copied, setCopied] = useState('');
  const [now, setNow] = useState(Date.now());

  const config = useMemo(() => ({ withCredentials: true, headers: { Authorization: `Bearer ${token}` } }), [token]);
  const userOptions = useMemo(() => users.filter((user) =>
    user.enabled && !nonInteractiveUsers.has(user.username.toLowerCase())).map((user) => ({
    value: user.username,
    label: user.displayName ? `${user.displayName} · ${user.username}` : user.username,
    needsEnrollment: !!user.needsEnrollment,
  })), [users]);
  const enrollmentOptions = useMemo(() => userOptions.filter((option) => option.needsEnrollment), [userOptions]);
  const availableCodeTypes = enrollmentOptions.length ? codeTypes : codeTypes.filter((option) => option.value !== 'enrollment');
  const recipientOptions = kind === 'enrollment' ? enrollmentOptions : userOptions;

  useEffect(() => {
    if (kind === 'enrollment' && !enrollmentOptions.length) {
      setKind('invite');
      setEmail('');
    }
  }, [kind, enrollmentOptions.length]);

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
    if (!email.trim()) return;
    setBusy(true); setError('');
    try {
      const recipient = email.trim().toLowerCase();
      const { data } = await axios.post(`${base}/codes`, { kind, email: recipient, displayName: displayName.trim() }, config);
      setShown({ kind, email: recipient, code: data.code, expiresAt: data.expires_at });
      setCopied('');
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
    setBusy(true); setError('');
    try {
      const { data } = await axios.post(`${base}/users/${encodeURIComponent(selected)}/reset-password`, {}, config);
      setTemporary({ email: selected, password: data.temporaryPassword, expiresAt: data.expiresAt });
      setCopied('');
    } catch (reason) { setError(reason.response?.data?.error || 'Unable to reset password'); }
    finally { setBusy(false); }
  }

  async function copy(value) {
    try { await navigator.clipboard.writeText(value); setCopied(value); }
    catch { setError('Could not copy automatically. Select the code or password to copy it.'); }
  }

  const withStatus = codes.map((code) => ({ ...code, status: code.status === 'active' &&
    new Date(code.expires_at).getTime() <= now ? 'expired' : code.status }));
  const activeCount = withStatus.filter((code) => code.status === 'active').length;
  const visible = history ? withStatus : withStatus.filter((code) => code.status === 'active');
  const remain = (date) => {
    const minutes = Math.max(0, Math.ceil((new Date(date).getTime() - now) / 60000));
    return minutes >= 1440 ? `${Math.ceil(minutes / 1440)} days` : `${minutes} min`;
  };

  return <section className="space-y-6">
    <div>
      <h2 className="text-xl font-semibold text-gray-900">Invitations and Account Recovery</h2>
      <p className="mt-1 text-sm text-gray-600">Create one-time access codes and help users regain access to their accounts.</p>
    </div>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

    <div className="grid gap-6 xl:grid-cols-2">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <h3 className="text-lg font-semibold text-gray-900">Create access code</h3>
        <p className="mt-1 text-sm text-gray-600">Codes are tied to one email and expire after seven days.</p>
        <form onSubmit={create} className="mt-5 space-y-4">
          <div>
            <label htmlFor="account-code-kind" className="block text-sm font-medium text-gray-700">Code type</label>
            <Select inputId="account-code-kind" instanceId="account-code-kind" className="mt-1.5" classNamePrefix="react-select"
              styles={selectStyles} isSearchable={false} options={availableCodeTypes}
              value={codeTypes.find((option) => option.value === kind)}
              onChange={(option) => { setKind(option.value); setEmail(''); setDisplayName(''); }} />
            <p className="mt-1.5 text-xs text-gray-500">{descriptions[kind]}</p>
          </div>
          {kind === 'invite' ? <>
            <div>
              <label htmlFor="invite-email" className="block text-sm font-medium text-gray-700">Recipient email</label>
              <input id="invite-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" className={fieldClass} />
            </div>
            <div>
              <label htmlFor="invite-name" className="block text-sm font-medium text-gray-700">Recipient name</label>
              <input id="invite-name" required maxLength={120} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Full name" className={fieldClass} />
            </div>
          </> : <div>
            <label htmlFor="account-code-recipient" className="block text-sm font-medium text-gray-700">Existing user</label>
            <Select inputId="account-code-recipient" instanceId="account-code-recipient" className="mt-1.5" classNamePrefix="react-select"
              styles={selectStyles} isClearable isSearchable placeholder="Search users..." options={recipientOptions}
              value={recipientOptions.find((option) => option.value === email) || null}
              onChange={(option) => setEmail(option?.value || '')}
              noOptionsMessage={() => kind === 'enrollment' ? 'No users need initial enrollment' : 'No enabled users found'} />
          </div>}
          <button type="submit" disabled={busy || !email.trim() || (kind === 'invite' && !displayName.trim())} className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? 'Working…' : 'Create code'}
          </button>
        </form>
        {shown && <SecretResult title={`${codeTypes.find((option) => option.value === shown.kind)?.label} for ${shown.email}`}
          value={shown.code} expiresAt={shown.expiresAt} copied={copied === shown.code}
          onCopy={() => copy(shown.code)} onHide={() => setShown(null)} />}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <h3 className="text-lg font-semibold text-gray-900">Temporary Password Reset</h3>
        <p className="mt-1 text-sm text-gray-600">Generate a temporary password when a user cannot remember theirs.</p>
        <div className="mt-5">
          <label htmlFor="reset-user" className="block text-sm font-medium text-gray-700">User account</label>
          <Select inputId="reset-user" instanceId="reset-user" className="mt-1.5" classNamePrefix="react-select"
            styles={selectStyles} isClearable isSearchable placeholder="Search users..." options={userOptions}
            value={userOptions.find((option) => option.value === selected) || null}
            onChange={(option) => setSelected(option?.value || '')} noOptionsMessage={() => 'No enabled users found'} />
        </div>
        <p className="mt-3 text-xs text-gray-500">This ends existing sessions. The user must change the temporary password at sign-in; it expires after 48 hours.</p>
        <button type="button" disabled={!selected || busy} onClick={resetPassword} className="mt-5 w-full rounded-lg border border-amber-600 bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? 'Working…' : 'Generate temporary password'}
        </button>
        {temporary && <SecretResult title={`Temporary password for ${temporary.email}`}
          value={temporary.password} expiresAt={temporary.expiresAt} copied={copied === temporary.password}
          onCopy={() => copy(temporary.password)} onHide={() => setTemporary(null)} />}
      </div>
    </div>

    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-4 sm:px-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Code activity</h3>
          <p className="mt-0.5 text-sm text-gray-600">Track recipients, expiration, and status.</p>
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 text-sm" aria-label="Code activity filter">
          <button type="button" aria-pressed={!history} onClick={() => setHistory(false)} className={`rounded-md px-3 py-1.5 font-medium transition-colors ${!history ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
            Pending <span className="ml-1 text-xs">{activeCount}</span>
          </button>
          <button type="button" aria-pressed={history} onClick={() => setHistory(true)} className={`rounded-md px-3 py-1.5 font-medium transition-colors ${history ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
            All activity
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[760px] w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Recipient</th>
              <th className="px-4 py-3 font-semibold">Type</th>
              <th className="px-4 py-3 font-semibold">Created by</th>
              <th className="px-4 py-3 font-semibold">Expires</th>
              <th className="px-4 py-3 font-semibold">Time left</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 text-right font-semibold">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visible.length ? visible.map((code) => <tr key={code.id} className="hover:bg-gray-50/70">
              <td className="px-4 py-3">
                <span className="block font-medium text-gray-900">{code.display_name || code.email}</span>
                {code.display_name && <span className="block text-xs text-gray-500">{code.email}</span>}
              </td>
              <td className="px-4 py-3 text-gray-700">{codeTypes.find((option) => option.value === code.kind)?.label || code.kind}</td>
              <td className="px-4 py-3 text-gray-600">{code.created_by_name || 'Bootstrap'}</td>
              <td className="whitespace-nowrap px-4 py-3 text-gray-600">{new Date(code.expires_at).toLocaleString()}</td>
              <td className="whitespace-nowrap px-4 py-3 text-gray-600">{code.status === 'active' ? remain(code.expires_at) : '—'}</td>
              <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${statusStyles[code.status] || statusStyles.expired}`}>{code.status}</span></td>
              <td className="px-4 py-3 text-right">{code.status === 'active' && <button type="button" disabled={busy} onClick={() => revoke(code.id)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50">Revoke</button>}</td>
            </tr>) : <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-500">{history ? 'No code activity yet.' : 'No pending codes.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  </section>;
}
