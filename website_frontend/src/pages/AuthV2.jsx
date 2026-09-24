import { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { AuthContext } from '../context/AuthContext';
import {
  loginUser, registerOptions, registerVerify, enrollOptions, enrollVerify,
  passkeyOptions, passkeyVerify, changeTemporaryPassword,
} from '../api/authApi';

export default function AuthV2() {
  const { token, login, initializing } = useContext(AuthContext);
  const navigate = useNavigate();
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
    if (token && !initializing) navigate('/', { replace: true });
  }, [token, initializing, navigate]);

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
        navigate('/', { replace: true });
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
    <main className="mx-4 mt-12 max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:mx-auto">
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
        {(mode === 'register' || mode === 'enroll') && <label className="block text-sm">
          {mode === 'register' ? 'Invitation code' : 'Enrollment code'}
          <input type="text" required autoComplete="off" value={code}
            onChange={(event) => setCode(event.target.value)} className="mt-1 w-full rounded border p-2" />
        </label>}
        {(mode === 'login' || mode === 'register') && <label className="block text-sm">
          Password<input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required
            value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded border p-2" />
        </label>}
        {(mode === 'enroll' || mode === 'temporary-password') && <label className="block text-sm">
          New password<input type="password" autoComplete="new-password" required value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)} className="mt-1 w-full rounded border p-2" />
        </label>}
        {mode !== 'login' && <label className="block text-sm">
          {mode === 'register' ? 'Confirm password' : 'Confirm new password'}
          <input type="password" autoComplete="new-password" required value={confirm}
            onChange={(event) => setConfirm(event.target.value)} className="mt-1 w-full rounded border p-2" />
        </label>}
        {mode !== 'login' && <p className="text-xs text-gray-600">Use at least 15 characters. Passphrases and password managers are supported.</p>}
        <button disabled={busy} className="w-full rounded-lg bg-blue-700 px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
          {busy ? 'Working…' : mode === 'login' ? 'Continue' : mode === 'register' ? 'Create Account' :
            mode === 'enroll' ? 'Change Password and Add Passkey' : 'Change Password'}
        </button>
      </form>
      {(mode === 'login' || mode === 'register') && <div className="mt-6 border-t border-gray-200 pt-5 text-center">
        {mode === 'login' && <p className="mb-2 text-xs text-gray-600">New to Wistron Labs?</p>}
        <button type="button" className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setMessage(''); }}>
          {mode === 'register' && <span aria-hidden="true">←</span>}
          {mode === 'login' ? 'Have an invitation code?' : 'Back to sign in'}
          {mode === 'login' && <span aria-hidden="true">→</span>}
        </button>
        {mode === 'login' && <p className="mt-4 text-xs text-gray-600">Forgot your password or passkey? Contact a super admin.</p>}
      </div>}
      {error && <div role="alert" className="mt-5 flex gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-5 w-5 shrink-0 text-red-600">
          <path fillRule="evenodd" d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 4a1 1 0 0 1 1 1v3a1 1 0 1 1-2 0V7a1 1 0 0 1 1-1Zm0 7a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" clipRule="evenodd" />
        </svg>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{mode === 'login' ? 'Sign-in failed' : 'Unable to continue'}</p>
          <p className="mt-0.5 break-words text-sm text-red-700">{error}</p>
        </div>
      </div>}
      {message && <div role="status" className="mt-5 flex gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-800">
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-5 w-5 shrink-0 text-green-600">
          <path fillRule="evenodd" d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm3.7 5.3a1 1 0 0 1 0 1.4l-4.5 4.5a1 1 0 0 1-1.4 0l-2-2a1 1 0 0 1 1.4-1.4l1.3 1.3 3.8-3.8a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
        </svg>
        <p className="text-sm font-medium">{message}</p>
      </div>}
    </main>
  );
}
