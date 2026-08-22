import { useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { authStore } from '@/lib/auth-store';
import { getDeviceToken } from '@/lib/register-device';
import LockScreen from '@/components/register/LockScreen';

/**
 * The register's front door.
 *
 * `RequireAuth` asked "is someone logged in", which meant a cashier needed an
 * email and a password to reach a till. This asks the two questions that
 * actually apply to a terminal: is this device enrolled, and is a till session
 * open on it.
 *
 * An unpaired terminal goes to `/pair` rather than to the PIN pad — and it does
 * so even when a session token is sitting in storage, because that token
 * belongs to some earlier back-office login, not to this till. `POST
 * /api/auth/till` refuses a caller with no device credential, so showing the
 * pad would be a dead end that reads as a wrong PIN.
 *
 * The session is read synchronously from `authStore`, never fetched, so there
 * is no pending frame in which an already-signed-on till flashes its lock
 * screen. That is also why `LockScreen` stores the token before calling back:
 * the callback below re-reads it, and the other order would put the pad
 * straight back up.
 */
export default function RequireTill({ children }: { children: ReactNode }) {
  const [sessionToken, setSessionToken] = useState(() => authStore.getToken());

  if (!getDeviceToken()) {
    return <Navigate to="/pair" replace />;
  }

  if (!sessionToken) {
    return <LockScreen onUnlocked={() => setSessionToken(authStore.getToken())} />;
  }

  return <>{children}</>;
}
