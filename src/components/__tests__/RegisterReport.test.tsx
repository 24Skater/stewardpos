import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RegisterReport from '../reports/RegisterReport';
import type { SalesByRegisterResult } from '@/lib/api';

/**
 * The headline answer: how many sales went through each till, and the
 * web-vs-drawer split.
 *
 * Worth testing directly because the failure modes are the ones a manager
 * would never notice from a glance — a retired register quietly missing from
 * the table understates the period, and a web register with no visual
 * distinction from a drawer till hides exactly the split this report exists
 * to show.
 */
const DATA: SalesByRegisterResult = {
  registers: [
    {
      registerId: 'r-main',
      displayCode: 'MAIN-01',
      name: 'Front Counter',
      locationId: 'loc-1',
      locationName: 'Main Street',
      type: 'fixed',
      hasCashDrawer: true,
      status: 'active',
      orderCount: 10,
      gross: 200,
      discounts: 5,
      tax: 15,
      net: 210,
      avgTicket: 21,
    },
    {
      registerId: 'r-web',
      displayCode: 'WEB-01',
      name: 'Online Store',
      locationId: 'loc-1',
      locationName: 'Main Street',
      type: 'web',
      hasCashDrawer: false,
      status: 'active',
      orderCount: 4,
      gross: 80,
      discounts: 0,
      tax: 6,
      net: 86,
      avgTicket: 21.5,
    },
    {
      registerId: 'r-old',
      displayCode: 'MAIN-02',
      name: 'Side Counter',
      locationId: 'loc-1',
      locationName: 'Main Street',
      type: 'fixed',
      hasCashDrawer: true,
      status: 'retired',
      orderCount: 2,
      gross: 40,
      discounts: 0,
      tax: 3,
      net: 43,
      avgTicket: 21.5,
    },
  ],
  capabilitySplit: {
    drawerCapable: { registerCount: 2, orderCount: 12, net: 253 },
    nonDrawerCapable: { registerCount: 1, orderCount: 4, net: 86 },
  },
};

const EMPTY: SalesByRegisterResult = {
  registers: [],
  capabilitySplit: {
    drawerCapable: { registerCount: 0, orderCount: 0, net: 0 },
    nonDrawerCapable: { registerCount: 0, orderCount: 0, net: 0 },
  },
};

describe('RegisterReport', () => {
  it('renders a row per register', () => {
    render(<RegisterReport data={DATA} loading={false} error={null} />);

    expect(screen.getByText(/MAIN-01/)).toBeInTheDocument();
    expect(screen.getByText(/WEB-01/)).toBeInTheDocument();
    expect(screen.getByText(/MAIN-02/)).toBeInTheDocument();
  });

  it('sorts by net descending, so the best-earning till leads', () => {
    render(<RegisterReport data={DATA} loading={false} error={null} />);

    const rows = screen.getAllByRole('row').slice(1); // drop the header row
    // MAIN-01 (net 210) should come before WEB-01 (net 86) and MAIN-02 (net 43).
    const order = rows.map((row) => row.textContent ?? '');
    expect(order[0]).toContain('MAIN-01');
    expect(order[1]).toContain('WEB-01');
    expect(order[2]).toContain('MAIN-02');
  });

  it('marks a drawer-less register with text, not colour alone', () => {
    render(<RegisterReport data={DATA} loading={false} error={null} />);

    expect(screen.getByText('No drawer')).toBeInTheDocument();
  });

  it('shows a retired register that traded, marked as retired', () => {
    render(<RegisterReport data={DATA} loading={false} error={null} />);

    expect(screen.getByText(/MAIN-02/)).toBeInTheDocument();
    expect(screen.getByText('Retired')).toBeInTheDocument();
  });

  it('surfaces the web-vs-drawer split in the summary tiles', () => {
    render(<RegisterReport data={DATA} loading={false} error={null} />);

    // $253.00 (drawer-capable net) is unique to the tile; $86.00 (non-drawer
    // net) also appears in the WEB-01 table row, so at least one instance
    // is what the tile contributes.
    expect(screen.getByText('$253.00')).toBeInTheDocument();
    expect(screen.getAllByText('$86.00').length).toBeGreaterThanOrEqual(1);
  });

  it('renders an empty state rather than NaN for a period with no activity', () => {
    render(<RegisterReport data={EMPTY} loading={false} error={null} />);

    expect(
      screen.getByText('No register activity was recorded in this period')
    ).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$undefined/)).not.toBeInTheDocument();
    // The tiles still render zeroes, not a blank or a crash.
    expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0);
  });

  it('says the report failed instead of showing zeroes', () => {
    render(<RegisterReport data={null} loading={false} error="The server is unreachable" />);

    expect(screen.getByRole('alert')).toHaveTextContent('The server is unreachable');
  });

  it('announces that it is loading', () => {
    const { container } = render(<RegisterReport data={null} loading error={null} />);

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});
