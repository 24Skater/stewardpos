import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SalesReport, { money, type SalesReportData } from '../reports/SalesReport';
import ReportRangePicker from '../ReportRangePicker';

/**
 * The report surface: what it shows, and what it shows when there is nothing or
 * something went wrong.
 *
 * Worth testing rather than eyeballing because the failure modes here are quiet
 * ones. An empty period and a failed request both used to render as a page of
 * zeroes, which reads as "the shop took nothing today" — a wrong answer stated
 * confidently, which is worse than an error.
 */
const DATA: SalesReportData = {
  summary: {
    from: Date.parse('2026-08-01T00:00:00.000Z'),
    to: Date.parse('2026-08-02T23:59:59.999Z'),
    orderCount: 3,
    gross: 40,
    discounts: 2,
    tax: 2.24,
    net: 40.24,
    refunds: 5.44,
    netAfterRefunds: 34.8,
    avgTicket: 13.41,
    pendingRefunds: 10,
  },
  byDay: [
    { date: '2026-08-01', orderCount: 2, gross: 30, net: 29.44 },
    { date: '2026-08-02', orderCount: 1, gross: 10, net: 10.8 },
  ],
  topProducts: [{ productId: 'p-tea', name: 'Loose Leaf Tea', quantity: 6, revenue: 30 }],
  paymentMix: [
    { method: 'cash', count: 2, amount: 23.44 },
    { method: 'card', count: 2, amount: 16.8 },
  ],
  returns: {
    from: 0,
    to: 0,
    returnCount: 1,
    refunded: 5.44,
    pendingCount: 1,
    pendingAmount: 10,
    byReason: [{ reasonCode: 'defective', returnCount: 1, refunded: 5.44 }],
  },
};

const EMPTY: SalesReportData = {
  summary: { ...DATA.summary, orderCount: 0, gross: 0, discounts: 0, tax: 0, net: 0, refunds: 0, netAfterRefunds: 0, avgTicket: 0, pendingRefunds: 0 },
  byDay: [],
  topProducts: [],
  paymentMix: [],
  returns: { ...DATA.returns, returnCount: 0, refunded: 0, pendingCount: 0, pendingAmount: 0, byReason: [] },
};

describe('money', () => {
  it('always shows both cents', () => {
    expect(money(40)).toBe('$40.00');
    expect(money(40.2)).toBe('$40.20');
  });
});

describe('SalesReport', () => {
  it('shows the server figures without recomputing them', () => {
    render(<SalesReport data={DATA} loading={false} error={null} />);

    expect(screen.getByText('$40.24')).toBeInTheDocument();
    expect(screen.getByText('$40.00')).toBeInTheDocument();
    expect(screen.getByText('$2.24')).toBeInTheDocument();
    expect(screen.getByText('$13.41')).toBeInTheDocument();
    expect(screen.getByText('$34.80')).toBeInTheDocument();
  });

  it('says what is only committed, not yet paid out', () => {
    render(<SalesReport data={DATA} loading={false} error={null} />);

    expect(screen.getByText('$10.00 pending approval')).toBeInTheDocument();
  });

  it('shows the tender split with each method as a share of the whole', () => {
    render(<SalesReport data={DATA} loading={false} error={null} />);

    // 23.44 of 40.24 is 58%; 16.80 is 42%.
    expect(screen.getByText('58%')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('names an empty period rather than showing an empty table', () => {
    render(<SalesReport data={EMPTY} loading={false} error={null} />);

    expect(screen.getByText('No sales were recorded in this period')).toBeInTheDocument();
    expect(screen.getByText('No sales data for this period')).toBeInTheDocument();
  });

  it('does not divide by a period with nothing tendered', () => {
    render(<SalesReport data={EMPTY} loading={false} error={null} />);

    expect(screen.queryByText('NaN%')).not.toBeInTheDocument();
  });

  it('says a report failed instead of showing zeroes', () => {
    // The distinction that matters: "the shop took nothing" and "we could not
    // find out what the shop took" are different statements.
    render(<SalesReport data={null} loading={false} error="The server is unreachable" />);

    expect(screen.getByRole('alert')).toHaveTextContent('The server is unreachable');
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('announces that it is loading', () => {
    const { container } = render(<SalesReport data={null} loading error={null} />);

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText('Loading report')).toBeInTheDocument();
  });

  it('hides the returns breakdown when nothing came back', () => {
    render(<SalesReport data={EMPTY} loading={false} error={null} />);

    expect(screen.queryByText('Why things came back')).not.toBeInTheDocument();
  });
});

describe('ReportRangePicker', () => {
  it('reports the preset and its range when one is chosen', () => {
    const onChange = vi.fn();
    render(
      <ReportRangePicker
        period="30days"
        range={{ from: '2026-07-18', to: '2026-08-16' }}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));

    expect(onChange).toHaveBeenCalledWith('today', expect.objectContaining({ from: expect.any(String) }));
    const [, range] = onChange.mock.calls[0];
    expect(range.from).toBe(range.to);
  });

  it('marks the active preset for assistive technology', () => {
    render(
      <ReportRangePicker period="7days" range={{ from: '2026-08-10', to: '2026-08-16' }} onChange={vi.fn()} />
    );

    expect(screen.getByRole('button', { name: 'Last 7 Days' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('pulls the other end along rather than asking for a backwards range', () => {
    // The server answers a backwards range with a 400. Typing a start date
    // after the end is a normal thing to do halfway through picking a period,
    // and should not produce an error.
    const onChange = vi.fn();
    render(
      <ReportRangePicker period="custom" range={{ from: '2026-08-01', to: '2026-08-05' }} onChange={onChange} />
    );

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-08-20' } });

    const [, range] = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(range.from <= range.to).toBe(true);
  });
});
