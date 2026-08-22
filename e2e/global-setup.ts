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

  await page.context().storageState({ path: STORAGE_STATE });
  await browser.close();
}
