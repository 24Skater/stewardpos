import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CashierReport from '../reports/CashierReport';
import type { CashierSales } from '@/lib/api';

/** The report the whole PIN-and-shift phase existed to make possible. */
const DATA: CashierSales[] = [
  { cashierUserId: 'u-alex', cashierName: 'Alex', orderCount: 6, gross: 120, net: 118, avgTicket: 19.67 },
  { cashierUserId: 'u-sam', cashierName: 'Sam', orderCount: 3, gross: 60, net: 58, avgTicket: 19.33 },
  { cashierUserId: 'unknown', cashierName: 'Unknown', orderCount: 1, gross: 10, net: 10, avgTicket: 10 },
];

describe('CashierReport', () => {
  it('renders a row per cashier', () => {
    render(<CashierReport data={DATA} loading={false} error={null} />);

    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.getByText('Sam')).toBeInTheDocument();
  });

  it('sorts by net descending', () => {
    render(<CashierReport data={DATA} loading={false} error={null} />);

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0].textContent).toContain('Alex');
    expect(rows[1].textContent).toContain('Sam');
  });

  it('labels pre-migration orders rather than showing a raw id', () => {
    render(<CashierReport data={DATA} loading={false} error={null} />);

    expect(screen.getByText('Unattributed (before shift tracking)')).toBeInTheDocument();
    expect(screen.queryByText('unknown')).not.toBeInTheDocument();
  });

  it('renders an empty state rather than NaN for a period with no activity', () => {
    render(<CashierReport data={[]} loading={false} error={null} />);

    expect(screen.getByText('No cashier activity was recorded in this period')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('says the report failed instead of showing zeroes', () => {
    render(<CashierReport data={null} loading={false} error="The server is unreachable" />);

    expect(screen.getByRole('alert')).toHaveTextContent('The server is unreachable');
  });

  it('announces that it is loading', () => {
    const { container } = render(<CashierReport data={null} loading error={null} />);

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});
