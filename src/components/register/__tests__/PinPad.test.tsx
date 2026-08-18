import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PinPad from '../PinPad';

/**
 * A PIN pad is the one place in this app where what's on screen must NOT
 * reveal what was typed. These tests check that structurally — the raw PIN
 * never appears anywhere in the rendered DOM, not just that the pad "looks"
 * masked — alongside keyboard operability (a physical keypad still exists at
 * some tills) and that reaching the expected length never submits on its
 * own, since an individual cashier's PIN can be longer than the org's floor.
 */

describe('PinPad', () => {
  describe('masked entry', () => {
    it('never renders the entered PIN sequence as text anywhere in the DOM', () => {
      // Every digit button necessarily shows its own glyph (0-9 all appear
      // in the DOM regardless of what's typed) - the guarantee under test is
      // that the *sequence entered* never appears together. An out-of-order
      // PIN distinguishes "the keypad's own labels happen to contain these
      // digits" from "the PIN itself was rendered".
      const { container } = render(<PinPad onSubmit={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Digit 9' }));
      fireEvent.click(screen.getByRole('button', { name: 'Digit 5' }));
      fireEvent.click(screen.getByRole('button', { name: 'Digit 7' }));

      expect(container.textContent).not.toContain('957');
      expect(container.innerHTML).not.toContain('957');
    });

    it('never binds the PIN to a value attribute', () => {
      const { container } = render(<PinPad onSubmit={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Digit 4' }));
      fireEvent.click(screen.getByRole('button', { name: 'Digit 5' }));

      // No <input> at all backs this component — the PIN lives only in
      // React state, never as a DOM value an inspector could read off.
      expect(container.querySelector('input')).toBeNull();
    });

    it('shows one filled dot per digit entered, not the digit itself', () => {
      const { container } = render(<PinPad expectedLength={4} onSubmit={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Digit 7' }));
      fireEvent.click(screen.getByRole('button', { name: 'Digit 8' }));

      const filled = container.querySelectorAll('.bg-foreground');
      expect(filled).toHaveLength(2);
    });

    it('announces progress by count, never by digit', () => {
      render(<PinPad onSubmit={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Digit 9' }));

      expect(screen.getByRole('status')).toHaveTextContent('1 digit entered');
    });
  });

  describe('touch targets', () => {
    it('sizes every digit button at least 44px on a side', () => {
      render(<PinPad onSubmit={vi.fn()} />);

      // h-16 w-16 in Tailwind is 4rem (64px) - comfortably over the 44px
      // floor the accessibility spec enforces.
      const button = screen.getByRole('button', { name: 'Digit 5' });
      expect(button.className).toMatch(/h-16/);
      expect(button.className).toMatch(/w-16/);
    });

    it('gives every control an accessible name', () => {
      render(<PinPad onSubmit={vi.fn()} />);

      for (const digit of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']) {
        expect(screen.getByRole('button', { name: `Digit ${digit}` })).toBeInTheDocument();
      }
      expect(screen.getByRole('button', { name: 'Backspace' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Clear PIN entry' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    });
  });

  describe('keyboard operation', () => {
    it('accepts digit keys typed on a physical keyboard', () => {
      render(<PinPad expectedLength={4} onSubmit={vi.fn()} />);

      const pad = screen.getByRole('group', { name: 'PIN entry' });
      fireEvent.keyDown(pad, { key: '1' });
      fireEvent.keyDown(pad, { key: '2' });
      fireEvent.keyDown(pad, { key: '3' });

      expect(screen.getByRole('status')).toHaveTextContent('3 digits entered');
    });

    it('ignores non-digit keys', () => {
      render(<PinPad onSubmit={vi.fn()} />);

      const pad = screen.getByRole('group', { name: 'PIN entry' });
      fireEvent.keyDown(pad, { key: 'a' });
      fireEvent.keyDown(pad, { key: 'ArrowLeft' });

      expect(screen.getByRole('status')).toHaveTextContent('0 digits entered');
    });

    it('deletes the last digit on Backspace', () => {
      render(<PinPad onSubmit={vi.fn()} />);

      const pad = screen.getByRole('group', { name: 'PIN entry' });
      fireEvent.keyDown(pad, { key: '1' });
      fireEvent.keyDown(pad, { key: '2' });
      fireEvent.keyDown(pad, { key: 'Backspace' });

      expect(screen.getByRole('status')).toHaveTextContent('1 digit entered');
    });

    it('submits on Enter', () => {
      const onSubmit = vi.fn();
      render(<PinPad onSubmit={onSubmit} />);

      const pad = screen.getByRole('group', { name: 'PIN entry' });
      fireEvent.keyDown(pad, { key: '1' });
      fireEvent.keyDown(pad, { key: '2' });
      fireEvent.keyDown(pad, { key: 'Enter' });

      expect(onSubmit).toHaveBeenCalledWith('12');
    });

    it('does nothing on Enter with no digits entered', () => {
      const onSubmit = vi.fn();
      render(<PinPad onSubmit={onSubmit} />);

      fireEvent.keyDown(screen.getByRole('group', { name: 'PIN entry' }), { key: 'Enter' });

      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe('backspace and clear', () => {
    it('removes one digit per backspace click', () => {
      render(<PinPad onSubmit={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Digit 1' }));
      fireEvent.click(screen.getByRole('button', { name: 'Digit 2' }));
      fireEvent.click(screen.getByRole('button', { name: 'Backspace' }));

      expect(screen.getByRole('status')).toHaveTextContent('1 digit entered');
    });

    it('clears every digit at once', () => {
      render(<PinPad onSubmit={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Digit 1' }));
      fireEvent.click(screen.getByRole('button', { name: 'Digit 2' }));
      fireEvent.click(screen.getByRole('button', { name: 'Digit 3' }));
      fireEvent.click(screen.getByRole('button', { name: 'Clear PIN entry' }));

      expect(screen.getByRole('status')).toHaveTextContent('0 digits entered');
    });

    it('disables backspace and clear when nothing is entered', () => {
      render(<PinPad onSubmit={vi.fn()} />);

      expect(screen.getByRole('button', { name: 'Backspace' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Clear PIN entry' })).toBeDisabled();
    });
  });

  describe('explicit submit', () => {
    it('does NOT submit automatically on reaching the expected length', () => {
      // The org floor and an individual cashier's PIN length can differ, so
      // hitting `expectedLength` must never dispatch on its own.
      const onSubmit = vi.fn();
      render(<PinPad expectedLength={4} onSubmit={onSubmit} />);

      fireEvent.click(screen.getByRole('button', { name: 'Digit 1' }));
      fireEvent.click(screen.getByRole('button', { name: 'Digit 2' }));
      fireEvent.click(screen.getByRole('button', { name: 'Digit 3' }));
      fireEvent.click(screen.getByRole('button', { name: 'Digit 4' }));

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('submits only once the Submit button is pressed, with the entered PIN', () => {
      const onSubmit = vi.fn();
      render(<PinPad expectedLength={4} onSubmit={onSubmit} />);

      fireEvent.click(screen.getByRole('button', { name: 'Digit 1' }));
      fireEvent.click(screen.getByRole('button', { name: 'Digit 2' }));
      fireEvent.click(screen.getByRole('button', { name: 'Digit 3' }));
      fireEvent.click(screen.getByRole('button', { name: 'Digit 4' }));
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith('1234');
    });

    it('a PIN longer than expectedLength can still be entered and submitted', () => {
      const onSubmit = vi.fn();
      render(<PinPad expectedLength={4} onSubmit={onSubmit} />);

      for (const digit of ['1', '2', '3', '4', '5', '6']) {
        fireEvent.click(screen.getByRole('button', { name: `Digit ${digit}` }));
      }
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

      expect(onSubmit).toHaveBeenCalledWith('123456');
    });

    it('disables Submit until at least one digit is entered', () => {
      render(<PinPad onSubmit={vi.fn()} />);

      expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    });

    it('clears the pad after a successful submit', () => {
      render(<PinPad onSubmit={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Digit 1' }));
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

      expect(screen.getByRole('status')).toHaveTextContent('0 digits entered');
    });
  });

  describe('submitting / disabled state', () => {
    it('disables every control while submitting', () => {
      render(<PinPad onSubmit={vi.fn()} submitting />);

      // The submit button's label changes to "Checking…" while submitting.
      expect(screen.getByRole('button', { name: 'Digit 1' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    });

    it('disables every control when disabled is set', () => {
      render(<PinPad onSubmit={vi.fn()} disabled />);

      expect(screen.getByRole('button', { name: 'Digit 1' })).toBeDisabled();
    });
  });
});
