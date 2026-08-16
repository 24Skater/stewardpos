import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PERIOD_LABELS, periodRange, type ReportPeriod } from '@/lib/report-range';
import type { ReportRangeQuery } from '@/lib/api';

interface ReportRangePickerProps {
  period: ReportPeriod;
  range: ReportRangeQuery;
  onChange: (period: ReportPeriod, range: ReportRangeQuery) => void;
}

const PRESETS: Exclude<ReportPeriod, 'custom'>[] = ['today', '7days', '30days'];

/**
 * The period every report screen is scoped to.
 *
 * One component so the presets cannot drift apart between screens, and so the
 * range a report was run for is always visible — a page of figures with no
 * stated period is not a report, it is a number.
 *
 * Native date inputs rather than a popover calendar: they are keyboard- and
 * screen-reader-accessible without any work, they carry the platform's own
 * locale handling, and the value is already the `YYYY-MM-DD` the API takes.
 */
export default function ReportRangePicker({ period, range, onChange }: ReportRangePickerProps) {
  const setCustom = (patch: Partial<ReportRangeQuery>) => {
    const next = { ...range, ...patch };
    // Typing a start after the end would ask the server for a backwards range
    // and get a 400. Nudge the other end instead of showing an error for
    // something the user is halfway through doing.
    if (next.from && next.to && next.from > next.to) {
      if (patch.from) next.to = next.from;
      else next.from = next.to;
    }
    onChange('custom', next);
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div
        className="flex gap-2"
        role="group"
        aria-label="Reporting period"
      >
        {PRESETS.map((preset) => (
          <Button
            key={preset}
            variant={period === preset ? 'default' : 'outline'}
            aria-pressed={period === preset}
            onClick={() => onChange(preset, periodRange(preset))}
          >
            {PERIOD_LABELS[preset]}
          </Button>
        ))}
      </div>

      <div className="flex items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor="report-from" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input
            id="report-from"
            type="date"
            className="w-40"
            value={range.from ?? ''}
            max={range.to}
            onChange={(event) => setCustom({ from: event.target.value })}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="report-to" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input
            id="report-to"
            type="date"
            className="w-40"
            value={range.to ?? ''}
            min={range.from}
            onChange={(event) => setCustom({ to: event.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
