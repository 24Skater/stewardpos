/**
 * Who to name as the actor on an audit row.
 *
 * Not every audited action has a person behind it. A terminal redeeming a
 * pairing code has no session at all, and an API key authenticates as
 * `api-key:<name>` — a principal the permission system invents so a non-human
 * caller can be authorised like a person. `services/audit.ts` records those as
 * a label with a null `userId`; see migration 021 for why the column had to
 * become nullable before any of it could be stored.
 *
 * The screen previously showed "Unknown" for anything without a user name,
 * which is wrong twice over: the caller is not unknown — the row says exactly
 * what it was — and calling it unknown suggests the log lost something, which
 * is the impression to avoid on the one screen an operator consults when they
 * suspect it has.
 */
export interface AuditActor {
  userName?: string | null;
  userEmail?: string | null;
  actorLabel?: string | null;
}

const API_KEY_PREFIX = 'api-key:';
const REGISTER_PREFIX = 'register:';

export function describeActor(log: AuditActor): string {
  if (log.userName) return log.userName;

  if (log.actorLabel?.startsWith(API_KEY_PREFIX)) {
    return `API key: ${log.actorLabel.slice(API_KEY_PREFIX.length)}`;
  }
  // The register's id follows the prefix, which is noise in a table column —
  // the row's own entity and payload say which till it was.
  if (log.actorLabel?.startsWith(REGISTER_PREFIX)) return 'Register (device)';
  if (log.actorLabel) return log.actorLabel;

  if (log.userEmail) return log.userEmail;

  // Genuinely nothing recorded: a device-authenticated route that named no
  // actor, such as a terminal enrolling itself.
  return 'No signed-in user';
}
