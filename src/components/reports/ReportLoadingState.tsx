import { Skeleton } from '@/components/ui/skeleton';

/**
 * The loading placeholder shared by the report cards that sit alongside
 * `SalesReport` — `RegisterReport`, `CashierReport`, `LossPreventionReport`.
 * Mirrors the shape `SalesReport` uses locally rather than introducing a
 * different loading vocabulary for the same kind of screen.
 */
export function ReportLoadingState({ tiles = 0 }: { tiles?: number }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading report</span>
      {tiles > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: tiles }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      )}
      <Skeleton className="h-72 w-full" />
    </div>
  );
}
