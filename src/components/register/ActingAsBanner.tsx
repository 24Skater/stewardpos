import { Button } from '@/components/ui/button';
import { UserCog } from 'lucide-react';

interface ActingAsBannerProps {
  adminName: string;
  /** The cashier being covered, when one was named. */
  actingAs: string | null;
  onExit: () => void;
}

/**
 * Shown for the whole of an assumed till session.
 *
 * An admin driving a till that is not theirs is a state someone can forget they
 * are in, and the consequences land in the reports rather than on the screen.
 * The banner is deliberately loud and deliberately explicit that attribution
 * follows the admin, not the cashier being covered — this is the only place a
 * user is told that, and assuming the opposite is the easy mistake.
 *
 * It says so even when no cashier was named: an assumed session is still a
 * session someone can walk away from without ending.
 */
export default function ActingAsBanner({ adminName, actingAs, onExit }: ActingAsBannerProps) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-amber-500 bg-amber-50 px-4 py-2 dark:bg-amber-950"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <UserCog className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
        <span className="font-medium text-amber-900 dark:text-amber-100">
          {actingAs
            ? `${adminName} is covering ${actingAs}'s till`
            : `${adminName} is signed on to this till`}
        </span>
        <span className="text-amber-800/80 dark:text-amber-200/80">
          Sales are recorded against {adminName}.
        </span>
      </div>
      <Button variant="outline" size="sm" onClick={onExit}>
        End session
      </Button>
    </div>
  );
}
