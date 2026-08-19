import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LossPreventionReport, { type LossPreventionReportData } from '../reports/LossPreventionReport';

/** The two reports that catch problems: drawer variance and no-sale counts. */
const DATA: LossPreventionReportData = {
  drawerVariance: [
    {
      registerId: 'r-main',
      displayCode: 'MAIN-01',
      name: 'Front Counter',
      sessionCount: 5,
      totalVariance: -12.5,
      worstVariance: -8,
      shortCount: 2,
    },
    {
      registerId: 'r-side',
      displayCode: 'MAIN-02',
      name: 'Side Counter',
      sessionCount: 3,
      totalVariance: 2,
      worstVariance: 0,
      shortCount: 0,
    },
  ],
  noSales: [
    { registerId: 'r-main', displayCode: 'MAIN-01', name: 'Front Counter', noSaleCount: 7 },
    { registerId: 'r-side', displayCode: 'MAIN-02', name: 'Side Counter', noSaleCount: 1 },
  ],
};

const EMPTY: LossPreventionReportData = { drawerVariance: [], noSales: [] };

describe('LossPreventionReport', () => {
  it('renders drawer variance rows worst first', () => {
    render(<LossPreventionReport data={DATA} loading={false} error={null} />);

    const rows = screen.getAllByRole('row').filter((row) => row.textContent?.includes('MAIN-0'));
    expect(rows[0].textContent).toContain('MAIN-01');
  });

  it('labels a shortfall with the word "short", not colour alone', () => {
    render(<LossPreventionReport data={DATA} loading={false} error={null} />);

    expect(screen.getByText('2 short')).toBeInTheDocument();
    expect(screen.getAllByText(/\(short\)/).length).toBeGreaterThan(0);
  });

  it('renders no-sale counts, highest first', () => {
    render(<LossPreventionReport data={DATA} loading={false} error={null} />);

    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders an empty state rather than NaN for a period with nothing to report', () => {
    render(<LossPreventionReport data={EMPTY} loading={false} error={null} />);

    expect(screen.getByText('No drawer sessions closed in this period')).toBeInTheDocument();
    expect(screen.getByText('No no-sale drawer opens were recorded in this period')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('says the report failed instead of showing zeroes', () => {
    render(<LossPreventionReport data={null} loading={false} error="The server is unreachable" />);

    expect(screen.getByRole('alert')).toHaveTextContent('The server is unreachable');
  });

  it('announces that it is loading', () => {
    const { container } = render(<LossPreventionReport data={null} loading error={null} />);

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});
