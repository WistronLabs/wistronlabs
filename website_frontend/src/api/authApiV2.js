import axios from 'axios';

const base = `${import.meta.env.VITE_BACKEND_URL}/auth`;
const client = axios.create({ baseURL: base, withCredentials: true });
const bearer = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

export const loginUser = async (username, password) => (await client.post('/login', { username, password })).data;
export const getSuperAdminContacts = async () => (await client.get('/super-admin-contacts')).data;
export const registerOptions = async (email, code, password) =>
  (await client.post('/register/options', { email, code, password })).data;
export const registerVerify = async (flowId, response) =>
  (await client.post('/register/verify', { flowId, response })).data;
export const enrollOptions = async (flowToken, code, newPassword) =>
  (await client.post('/enroll/options', { flowToken, code, newPassword })).data;
export const enrollVerify = async (flowId, response) =>
  (await client.post('/enroll/verify', { flowId, response })).data;
export const passkeyOptions = async (flowToken) =>
  (await client.post('/passkey/options', { flowToken })).data;
export const passkeyVerify = async (flowId, response) =>
  (await client.post('/passkey/verify', { flowId, response })).data;
export const changeTemporaryPassword = async (flowToken, newPassword) =>
  (await client.post('/temporary-password', { flowToken, newPassword })).data;
export const changePassword = async (currentPassword, newPassword, token) =>
  (await client.post('/change-password', { currentPassword, newPassword }, bearer(token))).data;
export const getCurrentUser = async (token) => (await client.get('/me', bearer(token))).data;
export const refreshAccessToken = () => client.post('/refresh');
export const logoutUser = () => client.post('/logout');
