import { ValidationError } from '../utils/errors';
import type { DbRow } from '../adapters/db/types';
import type { DatabaseAdapter } from './database';

/**
 * Register and location business rules.
 *
 * A store running several tills needs each one named, numbered, and capped
 * against the org's licence — none of which the schema alone can decide.
 * This module is pure orchestration over the adapter methods added in the
 * prior task: no SQL here, so every rule is unit-testable without a
 * database.
 */

/** Mirrors `registers.display_code VARCHAR(50)` — see migration 015. */
const MAX_DISPLAY_CODE_LENGTH = 50;

/**
 * Diacritics decompose into a base letter plus combining marks under NFD.
 * Built from `String.fromCodePoint` rather than a literal character range in
 * the pattern: the "Combining Diacritical Marks" Unicode block (U+0300 to
 * U+036F) renders as invisible/zero-width glyphs in a source file, which is
 * unreadable and fragile across editors and encodings.
 */
const COMBINING_MARKS_START = 0x0300;
const COMBINING_MARKS_END = 0x036f;
const COMBINING_MARKS = new RegExp(
  `[${String.fromCodePoint(COMBINING_MARKS_START)}-${String.fromCodePoint(COMBINING_MARKS_END)}]`,
  'g'
);
const NON_ALPHANUMERIC_RUNS = /[^a-z0-9]+/g;
const LEADING_OR_TRAILING_HYPHENS = /^-+|-+$/g;

/**
 * Turn a free-text name into a URL- and display-code-safe slug.
 *
 * Diacritics are stripped rather than kept, because a slug that round-trips
 * through a URL cannot carry an accent: `café` has to become `cafe`, not a
 * percent-escaped byte sequence a store manager will never type back in.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(NON_ALPHANUMERIC_RUNS, '-')
    .replace(LEADING_OR_TRAILING_HYPHENS, '');
}

/**
 * Build a register's `display_code` from its location's slug and number.
 *
 * The column is `VARCHAR(50)` in Postgres but unenforced `TEXT` in SQLite,
 * so an over-long value passes every SQLite-backed test and only fails in
 * production with SQLSTATE 22001. The *slug* is truncated to make room —
 * never the number, which is the part that actually disambiguates the
 * register.
 */
export function buildDisplayCode(locationSlug: string, registerNumber: number): string {
  const slug = slugify(locationSlug);
  const suffix = `-${String(registerNumber).padStart(2, '0')}`;
  const maxSlugLength = Math.max(0, MAX_DISPLAY_CODE_LENGTH - suffix.length);
  const truncatedSlug = slug.slice(0, maxSlugLength);

  return `${truncatedSlug}${suffix}`.toUpperCase();
}

/**
 * The lowest positive integer not already in use.
 *
 * `usedNumbers` is expected to include retired registers' numbers — see
 * `SQLiteAdapter.getUsedRegisterNumbers` — so a retired "Register 2" is
 * never handed back out. That is the caller's responsibility to supply
 * correctly; this function just picks the smallest gap in whatever it is
 * given.
 */
export function nextRegisterNumber(usedNumbers: number[]): number {
  const used = new Set(usedNumbers);
  let candidate = 1;
  while (used.has(candidate)) {
    candidate += 1;
  }
  return candidate;
}

export interface CreateRegisterInput {
  orgId: string;
  locationId: string;
  name: string;
  placement?: string | null;
  type?: string;
  hasCashDrawer?: boolean;
  acceptsCash?: boolean;
  canRefund?: boolean;
  canOpenDrawerNoSale?: boolean;
  requireSignIn?: boolean;
  idleLockSeconds?: number;
  terminalProvider?: string | null;
  terminalDeviceId?: string | null;
  /** Caller-supplied override for the auto-derived code. */
  displayCode?: string;
  createdBy?: string | null;
}

/**
 * The outcome of {@link createRegister}.
 *
 * Mirrors the adapter's own `createRegister` vocabulary (a plain string tag
 * for each failure, the row itself for success) and adds the one failure
 * mode that only the service can detect: the org's register cap. Kept as a
 * union rather than a thrown error for every branch except genuinely
 * malformed input (an over-long override code), so the route can map each
 * outcome to a status code without a try/catch per case.
 */
export type CreateRegisterResult =
  | DbRow
  | 'bad_location'
  | 'duplicate_number'
  | 'duplicate_code'
  | { limitReached: number };

/**
 * Orchestrate creating a register: validate the location, enforce the org's
 * register cap, assign the next per-location number, derive (or validate)
 * the display code, then hand off to the adapter.
 *
 * Order matters: the location is checked first because every later step
 * depends on it (its org, its slug), the cap is checked before spending a
 * number on a register that will be refused anyway, and the number is
 * assigned before the code is built because the code embeds it.
 */
export async function createRegister(
  adapter: DatabaseAdapter,
  input: CreateRegisterInput
): Promise<CreateRegisterResult> {
  const location = await adapter.getLocationById(input.locationId);
  if (!location || String(location.orgId) !== input.orgId) {
    return 'bad_location';
  }

  const policy = await adapter.getOrgPolicy(input.orgId);
  const maxRegisters = policy?.maxRegisters ?? null;
  if (maxRegisters != null) {
    const occupiedSlots = await adapter.countRegistersForCap(input.orgId);
    if (occupiedSlots >= maxRegisters) {
      return { limitReached: maxRegisters };
    }
  }

  const usedNumbers = await adapter.getUsedRegisterNumbers(input.locationId);
  const registerNumber = nextRegisterNumber(usedNumbers);

  let displayCode: string;
  if (input.displayCode) {
    displayCode = input.displayCode.toUpperCase();
    if (displayCode.length > MAX_DISPLAY_CODE_LENGTH) {
      throw new ValidationError(
        `Display code must be ${MAX_DISPLAY_CODE_LENGTH} characters or fewer`
      );
    }
  } else {
    displayCode = buildDisplayCode(String(location.slug), registerNumber);
  }

  return adapter.createRegister({
    org_id: input.orgId,
    location_id: input.locationId,
    name: input.name,
    register_number: registerNumber,
    display_code: displayCode,
    placement: input.placement ?? null,
    type: input.type ?? 'fixed',
    has_cash_drawer: input.hasCashDrawer,
    accepts_cash: input.acceptsCash,
    can_refund: input.canRefund,
    can_open_drawer_no_sale: input.canOpenDrawerNoSale,
    require_sign_in: input.requireSignIn,
    idle_lock_seconds: input.idleLockSeconds,
    terminal_provider: input.terminalProvider ?? null,
    terminal_device_id: input.terminalDeviceId ?? null,
    created_by: input.createdBy ?? null,
  });
}

/**
 * Retire a register. Permanent: its number and display code are never
 * reused (see migration 015), because an old receipt must always resolve to
 * the till that printed it. Distinct from {@link disableRegister} — see
 * that function for why the two must not be merged.
 */
export async function retireRegister(adapter: DatabaseAdapter, id: string): Promise<DbRow | null> {
  return adapter.setRegisterStatus(id, 'retired');
}

/**
 * Take a register temporarily out of service. Unlike retiring, a disabled
 * register still occupies a slot against the org's `max_registers` cap —
 * `countRegistersForCap` counts `pending`, `active` and `disabled` alike —
 * because the physical device is expected back, not decommissioned.
 */
export async function disableRegister(adapter: DatabaseAdapter, id: string): Promise<DbRow | null> {
  return adapter.setRegisterStatus(id, 'disabled');
}
