import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import ReportRangePicker from "@/components/ReportRangePicker";
import SalesReport from "@/components/reports/SalesReport";
import { useSalesReport } from "@/hooks/queries";
import { describeRange, periodRange, type ReportPeriod } from "@/lib/report-range";
import { getErrorMessage } from "@/lib/errors";

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

  const { data, isLoading, error } = useSalesReport(range);

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
