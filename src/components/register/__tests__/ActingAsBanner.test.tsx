import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ActingAsBanner from '../ActingAsBanner';

/**
 * An admin driving a till that is not theirs is a state someone can forget they
 * are in, and the consequences land in the reports rather than on the screen.
 * The banner is the only place a user is told that attribution follows the
 * admin and not the cashier being covered — which is the easy thing to assume
 * the other way round.
 */
describe('ActingAsBanner', () => {
  it('names the admin and the cashier being covered', () => {
    render(<ActingAsBanner adminName="Admin User" actingAs="Sam Cashier" onExit={vi.fn()} />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Admin User');
    expect(banner).toHaveTextContent('Sam Cashier');
  });

  it('says sales attribute to the admin, so nobody assumes otherwise', () => {
    render(<ActingAsBanner adminName="Admin User" actingAs="Sam Cashier" onExit={vi.fn()} />);

    expect(screen.getByText(/recorded against Admin User/i)).toBeInTheDocument();
  });

  it('says so even when no cashier is being covered', () => {
    // An assumed session with no emulated cashier still attributes to the
    // admin, and is still a session someone can forget they are in.
    render(<ActingAsBanner adminName="Admin User" actingAs={null} onExit={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('Admin User');
    expect(screen.getByText(/recorded against Admin User/i)).toBeInTheDocument();
  });

  it('announces itself to assistive tech rather than sitting there silently', () => {
    render(<ActingAsBanner adminName="Admin User" actingAs="Sam" onExit={vi.fn()} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('offers a way out', () => {
    const onExit = vi.fn();
    render(<ActingAsBanner adminName="Admin User" actingAs="Sam" onExit={onExit} />);

    fireEvent.click(screen.getByRole('button', { name: /end|exit/i }));

    expect(onExit).toHaveBeenCalled();
  });
});
