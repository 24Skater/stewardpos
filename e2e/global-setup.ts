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
  /**
   * Not `DemoPass!1`, which the rest of this file signs in with.
   *
   * That value is the seeded demo credential: ten characters, published in
   * this repository, and now explicitly on the forbidden list in
   * `backend/src/services/passwordPolicy.ts` precisely so a demo install going
   * live cannot keep it. `POST /api/admin/users` refuses it.
   *
   * It has to differ for the admin account too, which the seeder writes
   * directly with `bcrypt.hash` and so never passes through the policy — that
   * asymmetry is deliberate, not an oversight: the policy governs passwords
   * being *chosen*, and the demo seed is a fixture.
   *
   * This account signs in by PIN in the specs, so the password only has to be
   * acceptable, never memorable.
   */
  password: 'Quiet-Harbour-Lantern-42',
};

/**
 * A register this suite owns, for the same reason it owns {@link TILL_USER}.
 *
 * A register holds exactly ONE enrolled device: `redeemPairingCode` revokes
 * whatever was enrolled before as `superseded_by_new_enrolment`. Pairing the
 * shop's own till here therefore *unpaired the human using it* — their next
 * request 401'd `REGISTER_TOKEN_INVALID`, which clears the device token and
 * routes to `/pair`, and re-pairing there stole the credential straight back
 * off this suite. Two parties, one slot, a loop that survives a hard refresh
 * because the revocation is real and server-side.
 *
 * Owning a separate register means a test run and a person at the counter are
 * never competing for the same credential.
 */
const TILL_REGISTER = {
  displayCode: 'E2E-01',
  name: 'E2E Till',
  // The specs sign a cashier on, so this has to be the mode that asks for one.
  requireSignIn: true,
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
 * Make sure {@link TILL_REGISTER} exists and is active, and return it.
 *
 * Created on demand rather than seeded, so a stack that predates this still
 * gets one, and matched on `displayCode` because that is what the create call
 * sets and what a human reads off the screen.
 */
async function ensureTillRegister(
  page: import('@playwright/test').Page,
  authed: Record<string, string>
): Promise<{ id: string }> {
  const locations = await page.request.get(`${API}/api/locations`, { headers: authed });
  const location = (await locations.json()).data?.find(
    (candidate: { status?: string }) => candidate.status === 'active'
  );
  if (!location) throw new Error('No active location to put the e2e register in.');

  const find = async () => {
    const response = await page.request.get(`${API}/api/registers`, { headers: authed });
    return (await response.json()).data?.find(
      (register: { displayCode?: string }) => register.displayCode === TILL_REGISTER.displayCode
    );
  };

  let register = await find();
  if (!register) {
    const created = await page.request.post(`${API}/api/registers`, {
      headers: authed,
      data: {
        locationId: location.id,
        name: TILL_REGISTER.name,
        displayCode: TILL_REGISTER.displayCode,
        requireSignIn: TILL_REGISTER.requireSignIn,
      },
    });
    if (!created.ok()) {
      throw new Error(`Could not create the e2e register: ${await created.text()}`);
    }
    register = (await created.json()).data;
  }

  // A new register starts `pending`; only an active one can open a shift.
  if (register.status !== 'active') {
    const activated = await page.request.post(
      `${API}/api/registers/${register.id}/activate`,
      { headers: authed }
    );
    if (!activated.ok()) {
      throw new Error(`Could not activate the e2e register: ${await activated.text()}`);
    }
  }

  return register;
}

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

  // Expected to fail when the account already exists, which is why the status
  // is not simply asserted. But "already exists" is not the only way this can
  // fail, and swallowing the rest cost a confusing debugging session: when the
  // password policy tightened, this started returning 400 and the only symptom
  // was `Could not create or find e2e.till@demo.local` twenty lines later,
  // pointing at the lookup rather than at the refusal.
  //
  // So: a conflict is fine, anything else says why.
  const created = await page.request.post(`${API}/api/admin/users`, {
    headers: authed,
    data: {
      email: TILL_USER.email,
      name: TILL_USER.name,
      password: TILL_USER.password,
      roleIds: [standard.id],
    },
  });

  if (!created.ok() && created.status() !== 409) {
    const body = await created.text();
    // 400 here is almost always the password policy. Naming the account and
    // the status turns a lookup failure back into the refusal it really is.
    throw new Error(
      `Could not create ${TILL_USER.email}: ${created.status()} ${body.slice(0, 200)}`
    );
  }

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

  const active = await ensureTillRegister(page, authed);

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
