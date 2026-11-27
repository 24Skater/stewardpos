/**
 * Refuse user changes that would lock the store out of its own admin screens.
 *
 * Nothing else stops it: an admin could deactivate themselves, or demote the
 * only other admin, and nobody would be left who can grant access back.
 */

export interface LockoutUser {
  id: string;
  status: string;
  roleIds: string[];
}

export type UserChange =
  | { id: string; status?: string; roleIds?: string[] }
  | { id: string; deleted: true };

/** Why the change is refused, or null when it is fine. */
export function lockoutProblem(
  users: LockoutUser[],
  adminRoleIds: Set<string>,
  actorId: string | undefined,
  change: UserChange
): string | null {
  const isAdmin = (u: LockoutUser) => u.status === 'active' && u.roleIds.some((r) => adminRoleIds.has(r));
  const target = users.find((u) => u.id === change.id);
  if (!target) return null; // the route's own 404 handles a missing user

  const after: LockoutUser | null =
    'deleted' in change
      ? null
      : { ...target, status: change.status ?? target.status, roleIds: change.roleIds ?? target.roleIds };

  if (change.id === actorId) {
    if (!after) return "You can't delete your own account.";
    if (after.status !== 'active') return "You can't deactivate your own account.";
    if (isAdmin(target) && !isAdmin(after)) return "You can't remove your own admin role.";
  }

  const adminsAfter = users.filter((u) => (u.id === change.id ? after && isAdmin(after) : isAdmin(u))).length;
  const adminsBefore = users.filter(isAdmin).length;
  if (adminsBefore > 0 && adminsAfter === 0) {
    return 'This is the last active admin. Make someone else an admin first.';
  }
  return null;
}
