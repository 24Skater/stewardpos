import { chromium } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STORAGE_STATE = path.join(__dirname, '.auth.json');

export default async function globalSetup() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto('http://localhost:8081/login');
  await page.waitForSelector('input[type="email"]');
  await page.fill('input[type="email"]', 'admin@demo.local');
  await page.fill('input[type="password"]', 'DemoPass!1');
  await page.click('button[type="submit"]');
  await page.waitForFunction(
    () => !window.location.pathname.startsWith('/login'),
    { timeout: 15_000 }
  );

  await page.context().storageState({ path: STORAGE_STATE });
  await browser.close();
}
