import { Navigate, useLocation } from 'react-router-dom';
import { Loader2, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession } from '@/hooks/queries/useSession';
import { hasPermission, isAdmin } from '@/lib/auth';
import type { RolePermissions } from '@/lib/permissions';

interface RequireAuthProps {
  children: React.ReactNode;
  /**
   * Permission the route needs. Omit for routes that any signed-in user may see
   * (the register itself, for one).
   */
  permission?: {
    domain: keyof RolePermissions;
    action: 'read' | 'write' | 'delete';
  };
  /**
   * Require the `admin` system role, matching a server route guarded by
   * `authorize(['admin'])` rather than by a permission.
   *
   * Only for routes where the server really does demand the role. A permission
   * is the better gate almost everywhere, because it can be granted to a custom
   * role; this exists because a handful of endpoints — key management, database
   * reset — are deliberately not delegable, and the UI has to say the same
   * thing the API will.
   */
  requireAdmin?: boolean;
}

/**
 * Gate a route on being signed in, and optionally on a permission.
 *
 * This is a usability and least-surprise measure, **not** the security boundary
 * — the API is. Every protected endpoint enforces the same rules server-side, so
 * a user who edits their way past this guard sees an empty page and a string of
 * 403s rather than data. What it buys is that an unauthorised user lands on the
 * login screen instead of a fully-drawn admin console that fails on every call.
 *
 * The redirect records where the user was headed so login can return them there.
 */
export default function RequireAuth({ children, permission, requireAdmin }: RequireAuthProps) {
  const { data: session, isPending } = useSession();
  const location = useLocation();

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="sr-only">Checking your session…</span>
      </div>
    );
  }

  if (!session) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  const refusal = (() => {
    if (requireAdmin && !isAdmin(session)) {
      return 'This is limited to administrators.';
    }
    if (permission && !hasPermission(session, permission.domain, permission.action)) {
      return `Your account cannot ${permission.action} ${permission.domain}.`;
    }
    return null;
  })();

  if (refusal) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <ShieldOff className="h-12 w-12 text-muted-foreground/60" />
        <div>
          <h1 className="text-lg font-semibold text-foreground">You don't have access to this</h1>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {refusal} Ask an administrator if you need it.
          </p>
        </div>
        <Button variant="outline" onClick={() => window.history.back()}>
          Go back
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}
