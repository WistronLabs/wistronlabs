import { useContext, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { AuthContext } from '../context/AuthContext';
import {
  loginUser, registerOptions, registerVerify, enrollOptions, enrollVerify,
  passkeyOptions, passkeyVerify, changeTemporaryPassword,
} from '../api/authApi';

export default function AuthV2() {
  const { token, login, initializing } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [flowToken, setFlowToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (token && !initializing) navigate('/user', { replace: true });
  }, [token, initializing, navigate]);

  const target = location.state?.from;
  const redirect = target && target.pathname !== '/auth'
    ? `${target.pathname}${target.search || ''}${target.hash || ''}` : '/';

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'login') {
        const result = await loginUser(email, password);
        setPassword('');
        if (result.next === 'enroll') {
          setFlowToken(result.flowToken);
          setMode('enroll');
          return;
        }
        if (result.next === 'temporary-password') {
          setFlowToken(result.flowToken);
          setMode('temporary-password');
          return;
        }
        const { flowId, options } = await passkeyOptions(result.flowToken);
        const response = await startAuthentication({ optionsJSON: options });
        const verified = await passkeyVerify(flowId, response);
        login(verified.token);
        navigate(redirect, { replace: true });
      } else if (mode === 'register') {
        if (password !== confirm) throw new Error('Passwords do not match');
        const { flowId, options } = await registerOptions(email, code, password);
        const response = await startRegistration({ optionsJSON: options });
        await registerVerify(flowId, response);
        setMode('login');
        setPassword(''); setConfirm(''); setCode('');
        setMessage('Account created. Sign in with your password and passkey.');
      } else if (mode === 'enroll') {
        if (newPassword !== confirm) throw new Error('Passwords do not match');
        const { flowId, options } = await enrollOptions(flowToken, code, newPassword);
        const response = await startRegistration({ optionsJSON: options });
        await enrollVerify(flowId, response);
        setMode('login');
        setCode(''); setNewPassword(''); setConfirm(''); setFlowToken('');
        setMessage('Enrollment complete. Sign in with your new password and passkey.');
      } else if (mode === 'temporary-password') {
        if (newPassword !== confirm) throw new Error('Passwords do not match');
        await changeTemporaryPassword(flowToken, newPassword);
        setMode('login');
        setNewPassword(''); setConfirm(''); setFlowToken('');
        setMessage('Password changed. Sign in with your new password and passkey.');
      }
    } catch (reason) {
      setError(reason.response?.data?.error || reason.message || 'Unable to continue');
    } finally { setBusy(false); }
  }

  return (
    <main className="mx-auto mt-16 max-w-md rounded-xl bg-white p-6 shadow">
      <h1 className="mb-5 text-2xl font-semibold">
        {mode === 'register' ? 'Redeem Invitation' :
          mode === 'enroll' ? 'Secure Your Account' :
          mode === 'temporary-password' ? 'Change Temporary Password' : 'Sign In'}
      </h1>
      {mode === 'login' && <p className="mb-4 text-sm text-gray-600">Enter your password, then confirm with your passkey.</p>}
      {mode === 'enroll' && <p className="mb-4 text-sm text-gray-600">Enter the code from a super admin, choose a new password, and add a passkey.</p>}
      {mode === 'temporary-password' && <p className="mb-4 text-sm text-gray-600">Choose a new password before using your account.</p>}
      <form onSubmit={submit} className="space-y-4">
        {(mode === 'login' || mode === 'register') && <label className="block text-sm">
          Email<input type="email" autoComplete="username" required value={email}
            onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded border p-2" />
        </label>}
        {(mode === 'login' || mode === 'register') && <label className="block text-sm">
          Password<input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required
            value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded border p-2" />
        </label>}
        {(mode === 'register' || mode === 'enroll') && <label className="block text-sm">
          {mode === 'register' ? 'Invitation code' : 'Enrollment code'}
          <input type="text" required autoComplete="off" value={code}
            onChange={(event) => setCode(event.target.value)} className="mt-1 w-full rounded border p-2" />
        </label>}
        {(mode === 'enroll' || mode === 'temporary-password') && <label className="block text-sm">
          New password<input type="password" autoComplete="new-password" required value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)} className="mt-1 w-full rounded border p-2" />
        </label>}
        {mode !== 'login' && <label className="block text-sm">
          Confirm new password<input type="password" autoComplete="new-password" required value={confirm}
            onChange={(event) => setConfirm(event.target.value)} className="mt-1 w-full rounded border p-2" />
        </label>}
        {mode !== 'login' && <p className="text-xs text-gray-600">Use at least 15 characters. Passphrases and password managers are supported.</p>}
        <button disabled={busy} className="w-full rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-60">
          {busy ? 'Working…' : mode === 'login' ? 'Continue' : mode === 'register' ? 'Create Account' :
            mode === 'enroll' ? 'Change Password and Add Passkey' : 'Change Password'}
        </button>
      </form>
      {(mode === 'login' || mode === 'register') && <button type="button" className="mt-4 text-sm text-blue-700 underline"
        onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setMessage(''); }}>
        {mode === 'login' ? 'Have an invitation code?' : 'Back to sign in'}
      </button>}
      {mode === 'login' && <p className="mt-4 text-xs text-gray-600">Forgot your password or passkey? Contact a super admin.</p>}
      {message && <p role="status" className="mt-4 text-sm text-green-700">{message}</p>}
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    </main>
  );
}
