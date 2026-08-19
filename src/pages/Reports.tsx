import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import ReportRangePicker from "@/components/ReportRangePicker";
import SalesReport from "@/components/reports/SalesReport";
import { useSalesReport, useRegisters, useLocations } from "@/hooks/queries";
import { describeRange, periodRange, type ReportPeriod } from "@/lib/report-range";
import { getErrorMessage } from "@/lib/errors";
import type { ReportRangeQuery } from "@/lib/api";

/**
 * The register's own report screen.
 *
 * Shows exactly what the admin one shows, from exactly the same endpoints. It
 * used to fetch every order and total them in the browser, with its own
 * definition of "revenue" — `sum(order.total)`, which includes tax and ignores
 * refunds — so the two screens could and did print different figures for the
 * same day.
 */
export default function Reports() {
  const [period, setPeriod] = useState<ReportPeriod>('7days');
  const [range, setRange] = useState(() => periodRange('7days'));
  const navigate = useNavigate();

  // Same register/location narrowing AdminReports.tsx offers — this screen
  // carries the same product-sales report, so it composes with the range
  // picker the same way there.
  const { data: registers } = useRegisters();
  const { data: locations } = useLocations();
  const [registerFilterId, setRegisterFilterId] = useState<string>('all');
  const [locationFilterId, setLocationFilterId] = useState<string>('all');

  const query: ReportRangeQuery = useMemo(
    () => ({
      ...range,
      registerIds: registerFilterId === 'all' ? undefined : [registerFilterId],
      locationIds: locationFilterId === 'all' ? undefined : [locationFilterId],
    }),
    [range, registerFilterId, locationFilterId]
  );

  const { data, isLoading, error } = useSalesReport(query);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-card px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/')}
              className="hover:bg-secondary"
              aria-label="Back to the register"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-foreground">Sales Reports</h1>
              <p className="text-xs text-muted-foreground">{describeRange(range)}</p>
            </div>
          </div>
          <ReportRangePicker
            period={period}
            range={range}
            onChange={(nextPeriod, nextRange) => {
              setPeriod(nextPeriod);
              setRange(nextRange);
            }}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label htmlFor="reports-register-filter" className="text-xs text-muted-foreground">
              Register
            </Label>
            <Select value={registerFilterId} onValueChange={setRegisterFilterId}>
              <SelectTrigger
                id="reports-register-filter"
                className="w-44"
                aria-label="Filter reports by register"
              >
                <SelectValue placeholder="All registers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All registers</SelectItem>
                {(registers ?? []).map((register) => (
                  <SelectItem key={register.id} value={register.id}>
                    {register.displayCode} — {register.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="reports-location-filter" className="text-xs text-muted-foreground">
              Location
            </Label>
            <Select value={locationFilterId} onValueChange={setLocationFilterId}>
              <SelectTrigger
                id="reports-location-filter"
                className="w-44"
                aria-label="Filter reports by location"
              >
                <SelectValue placeholder="All locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All locations</SelectItem>
                {(locations ?? []).map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    {location.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      <div className="p-6">
        <SalesReport
          data={data ?? null}
          loading={isLoading}
          error={error ? getErrorMessage(error, 'The report could not be loaded') : null}
        />
      </div>
    </div>
  );
}
