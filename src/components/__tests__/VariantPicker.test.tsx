import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import VariantPicker from '../VariantPicker';
import type { Product, ProductVariant } from '@/lib/api';

/**
 * Picking a size/colour at the till: only real choices are offered, the price
 * shown is the variant's price, and an out-of-stock combination cannot be added.
 */

function v(over: Partial<ProductVariant> & { id: string }): ProductVariant {
  return { stock: 5, enabled: true, priceDelta: 0, ...over };
}

function product(variants: ProductVariant[]): Product {
  return { id: 'p1', name: 'Tee', category: 'Apparel', basePrice: 20, variants, createdAt: 0, updatedAt: 0 };
}

const GRID = product([
  v({ id: 's-red', size: 'S', color: 'Red' }),
  v({ id: 's-blue', size: 'S', color: 'Blue', priceDelta: 2 }),
  v({ id: 'l-blue', size: 'L', color: 'Blue', priceOverride: 30, stock: 0 }),
  v({ id: 'xl-green', size: 'XL', color: 'Green', enabled: false }),
]);

function renderPicker(p: Product, open = true) {
  const onClose = vi.fn();
  const onAddToCart = vi.fn();
  render(<VariantPicker product={p} open={open} onClose={onClose} onAddToCart={onAddToCart} />);
  return { onClose, onAddToCart };
}

const addButton = () => screen.getByRole('button', { name: /add to cart/i });

describe('VariantPicker', () => {
  it('offers only the sizes and colours of enabled variants', () => {
    renderPicker(GRID);

    expect(screen.getByRole('button', { name: 'S' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'L' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'XL' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Green' })).not.toBeInTheDocument();
  });

  it('preselects the first in-stock variant so Add works straight away', () => {
    const { onAddToCart, onClose } = renderPicker(GRID);

    expect(screen.getByText('$20.00')).toBeInTheDocument();
    expect(screen.getByText('5 in stock')).toBeInTheDocument();
    fireEvent.click(addButton());

    expect(onAddToCart).toHaveBeenCalledWith('p1', 's-red');
    expect(onClose).toHaveBeenCalled();
  });

  it('prices the selected variant with its price delta', () => {
    const { onAddToCart } = renderPicker(GRID);

    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    fireEvent.click(addButton());

    expect(screen.getByText('$22.00')).toBeInTheDocument();
    expect(onAddToCart).toHaveBeenCalledWith('p1', 's-blue');
  });

  it('moves to a colour that exists when the chosen size lacks the current one', () => {
    renderPicker(GRID);

    // S/Red is selected; L only comes in Blue.
    fireEvent.click(screen.getByRole('button', { name: 'L' }));

    expect(screen.getByText('$30.00')).toBeInTheDocument();
    expect(screen.getByText('Out of stock')).toBeInTheDocument();
    expect(addButton()).toBeDisabled();
  });

  it('keeps the colour when the new size has it', () => {
    renderPicker(GRID);
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));

    fireEvent.click(screen.getByRole('button', { name: 'L' }));
    fireEvent.click(screen.getByRole('button', { name: 'S' }));

    expect(screen.getByText('$22.00')).toBeInTheDocument();
  });

  it('moves to a size that exists when the chosen colour lacks the current one', () => {
    const p = product([
      v({ id: 's-red', size: 'S', color: 'Red' }),
      v({ id: 'm-blue', size: 'M', color: 'Blue', priceDelta: 4 }),
    ]);
    const { onAddToCart } = renderPicker(p);

    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    fireEvent.click(addButton());

    expect(onAddToCart).toHaveBeenCalledWith('p1', 'm-blue');
  });

  it('adds directly and closes when there is only one in-stock variant', () => {
    const p = product([v({ id: 'only', size: 'S', color: 'Red' }), v({ id: 'gone', size: 'M', color: 'Red', stock: 0 })]);

    const { onAddToCart, onClose } = renderPicker(p);

    expect(onAddToCart).toHaveBeenCalledWith('p1', 'only');
    expect(onClose).toHaveBeenCalled();
  });

  it('adds directly when the variants offer no choice at all', () => {
    const p = product([v({ id: 'a' }), v({ id: 'b' })]);

    const { onAddToCart } = renderPicker(p);

    expect(onAddToCart).toHaveBeenCalledWith('p1', 'a');
  });

  it('does nothing while closed', () => {
    const { onAddToCart } = renderPicker(product([v({ id: 'a' })]), false);

    expect(onAddToCart).not.toHaveBeenCalled();
  });

  it('shows the base price when no enabled variant exists', () => {
    const p = product([v({ id: 'x', size: 'S', enabled: false }), v({ id: 'y', size: 'M', enabled: false })]);

    const { onAddToCart } = renderPicker(p);

    expect(screen.getByText('$20.00')).toBeInTheDocument();
    expect(addButton()).toBeDisabled();
    expect(onAddToCart).not.toHaveBeenCalled();
  });
});
