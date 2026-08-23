import { chromium } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STORAGE_STATE = path.join(__dirname, '.auth.json');

const API = 'http://localhost:3002';

/**
 * The keys `src/lib/register-device.ts` reads. Duplicated rather than imported:
 * this file runs in Node before any bundle exists, and the pair of them is the
 * contract a terminal is enrolled by.
 */
const REGISTER_ID_KEY = 'steward-terminal-register-id';
const REGISTER_TOKEN_KEY = 'steward-terminal-register-token';

/**
 * A cashier this suite owns outright, created on demand and never shared with a
 * human.
 *
 * It used to sign on as the seeded demo admin with the seeded PIN, and that
 * broke the moment somebody changed that PIN through Admin → Roles & Users —
 * an ordinary thing to do on a stack you are also using by hand. Owning the
 * account means the suite cannot be locked out of the till by a change nobody
 * connected to it, and it leaves real accounts' PINs alone.
 */
const TILL_USER = {
  email: 'e2e.till@demo.local',
  name: 'E2E Till',
  password: 'DemoPass!1',
};

/**
 * How many PINs to try before giving up.
 *
 * PINs are unique per organization (`services/pins.ts`), so a fixed constant
 * here is only ever one coincidence away from being unusable — a human picking
 * the same six digits in the admin UI would lock this suite out of the till
 * with a 409 and no obvious connection to what they did. Rather than hardcode,
 * pick digits and move on when they are taken. Six of them because
 * `MIN_PIN_LENGTH` is 6.
 */
const PIN_ATTEMPTS = 8;

const randomPin = () => String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');

/**
 * Make sure {@link TILL_USER} exists with a PIN this suite knows, and return it.
 *
 * Idempotent, and written to survive a database that already has the account
 * from a previous run: creating it again is expected to fail, and the PIN is
 * then simply re-set. The PIN is rewritten every run rather than trusted,
 * because a lockout or a hand-edit would otherwise leave the suite unable to
 * open a shift with no clue as to why.
 */
async function ensureTillUser(
  page: import('@playwright/test').Page,
  authed: Record<string, string>
): Promise<string> {
  const roles = await page.request.get(`${API}/api/admin/roles`, { headers: authed });
  const standard = (await roles.json()).data?.find(
    (role: { systemRole?: string }) => role.systemRole === 'standard'
  );
  if (!standard) throw new Error('No standard role to give the e2e till user.');

  // Expected to fail when the account already exists — the PIN write below is
  // what actually matters, so the response is deliberately not checked here.
  await page.request.post(`${API}/api/admin/users`, {
    headers: authed,
    data: {
      email: TILL_USER.email,
      name: TILL_USER.name,
      password: TILL_USER.password,
      roleIds: [standard.id],
    },
  });

  const users = await page.request.get(`${API}/api/admin/users`, { headers: authed });
  const user = (await users.json()).data?.find(
    (candidate: { email: string }) => candidate.email === TILL_USER.email
  );
  if (!user) throw new Error(`Could not create or find ${TILL_USER.email}.`);

  // An explicit PIN is an instruction, not a suggestion: if it is taken, say so
  // rather than quietly signing on as somebody the caller did not name.
  const override = process.env.E2E_REGISTER_PIN;
  const candidates = override ? [override] : Array.from({ length: PIN_ATTEMPTS }, randomPin);

  let lastFailure = '';
  for (const pin of candidates) {
    const response = await page.request.put(`${API}/api/admin/users/${user.id}/pin`, {
      headers: authed,
      data: { pin },
    });
    if (response.ok()) return pin;

    lastFailure = await response.text();
    // 409 is "those digits belong to somebody else" — the only failure worth
    // another go. Anything else is a real problem and retrying would hide it.
    if (response.status() !== 409) break;
  }

  throw new Error(`Could not give ${TILL_USER.email} a PIN: ${lastFailure}`);
}

export default async function globalSetup() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto('http://localhost:8081/login');
  await page.waitForSelector('input[type="email"]');
  await page.fill('input[type="email"]', 'admin@demo.local');
  await page.fill('input[type="password"]', 'DemoPass!1');
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !window.location.pathname.startsWith('/login'), {
    timeout: 15_000,
  });

  /**
   * Enrol this browser as a terminal.
   *
   * A signed-in session is no longer enough to reach the register: `RequireTill`
   * asks whether the *device* is paired and sends an unpaired one to `/pair`,
   * so without this every spec that opens `/pos` lands on the pairing screen
   * instead. Pairing is done through the API rather than by driving `/pair`,
   * because the pairing screen is not what these specs are testing.
   */
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  if (!token) throw new Error('Signed in but no auth token was stored; cannot pair a register.');

  const authed = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const registers = await page.request.get(`${API}/api/registers`, { headers: authed });
  const active = (await registers.json()).data?.find(
    (register: { status: string }) => register.status === 'active'
  );
  if (!active) throw new Error('No active register to pair against; is the database seeded?');

  const codeResponse = await page.request.post(
    `${API}/api/registers/${active.id}/pairing-code`,
    { headers: authed }
  );
  const { code } = (await codeResponse.json()).data;

  const paired = await page.request.post(`${API}/api/registers/pair`, {
    headers: { 'Content-Type': 'application/json' },
    data: { code },
  });
  const deviceToken = (await paired.json()).data?.token;
  if (!deviceToken) throw new Error(`Pairing failed: ${await paired.text()}`);

  await page.evaluate(
    ([idKey, tokenKey, id, value]) => {
      localStorage.setItem(idKey, id);
      localStorage.setItem(tokenKey, value);
    },
    [REGISTER_ID_KEY, REGISTER_TOKEN_KEY, String(active.id), deviceToken] as const
  );

  /**
   * Open a shift on that register.
   *
   * Pairing alone is not enough once the register has `require_sign_in` on:
   * `POS` puts its lock screen over the whole page until a cashier is signed
   * on, so every spec that clicks a product times out waiting behind a dialog
   * it never dismisses. The suite is not testing till auth — `LockScreen` and
   * `RequireTill` have their own unit tests — so it signs on the same way the
   * pairing above pairs: through the API, with the seeded demo PIN.
   *
   * Skipped when a shift is already open, because `POST /:id/shifts`
   * supersedes rather than refuses, and ending someone else's shift is a
   * rude thing for a test to do to a stack a human is also using.
   *
   * The session token stays the admin's: `POS` asks the *device* whether a
   * shift is open, and the admin surfaces the suite also exercises need
   * back-office permissions a till session would not carry.
   */
  const asDevice = {
    'X-Register-Token': deviceToken,
    'X-Register-Id': String(active.id),
    'Content-Type': 'application/json',
  };

  const current = await page.request.get(
    `${API}/api/registers/${active.id}/shifts/current`,
    { headers: asDevice }
  );
  const openShift = (await current.json()).data;

  if (!openShift) {
    const pin = await ensureTillUser(page, authed);

    const signedOn = await page.request.post(`${API}/api/registers/${active.id}/shifts`, {
      headers: asDevice,
      data: { pin },
    });
    if (!signedOn.ok()) {
      throw new Error(
        `Could not open a shift on ${active.id}: ${await signedOn.text()}`
      );
    }
  }

  await page.context().storageState({ path: STORAGE_STATE });
  await browser.close();
}
