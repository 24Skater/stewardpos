import { Card } from "@/components/ui/card";
import type { Product } from "@/lib/api";
import { ShoppingCart } from "lucide-react";

interface ProductCardProps {
  product: Product;
  onClick?: () => void;
}

export default function ProductCard({ product, onClick }: ProductCardProps) {
  const defaultVariant = product.variants[0];
  const inStock = product.variants.some(v => v.stock > 0);

  // A product tile is a control, not decoration: it puts an item in the cart.
  // As a bare div with an onClick it was unreachable from the keyboard
  // entirely — a cashier working by keyboard could not add anything to a sale.
  //
  // `role="button"` plus tabIndex and Enter/Space handling rather than a real
  // <button>, because the tile contains block-level layout that is invalid
  // inside a button element. Out-of-stock tiles are not focusable, matching the
  // click behaviour, and are marked disabled for a screen reader.
  return (
    <Card
      className="group overflow-hidden bg-card hover:shadow-lg transition-all duration-300 cursor-pointer border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--sp-gold))] focus-visible:ring-offset-2"
      role="button"
      tabIndex={inStock ? 0 : -1}
      aria-disabled={!inStock}
      aria-label={`${product.name}, $${product.basePrice.toFixed(2)}${inStock ? '' : ', out of stock'}`}
      onClick={() => inStock && onClick?.()}
      onKeyDown={(event) => {
        if (!inStock) return;
        if (event.key === 'Enter' || event.key === ' ') {
          // Space scrolls the page by default, which on a till moves the
          // catalog out from under the cashier instead of adding the item.
          event.preventDefault();
          onClick?.();
        }
      }}
    >
      <div className="aspect-square bg-secondary/30 relative overflow-hidden">
        {product.image ? (
          <img 
            src={product.image} 
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ShoppingCart className="w-16 h-16 text-muted-foreground/30" />
          </div>
        )}
        {!inStock && (
          <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
            <span className="text-sm font-semibold text-destructive">Out of Stock</span>
          </div>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-foreground truncate">{product.name}</h3>
        <p className="text-sm text-muted-foreground mt-1">{product.category}</p>
        <p className="text-lg font-bold text-primary mt-2">
          ${product.basePrice.toFixed(2)}
          {product.variants.length > 1 && (
            <span className="text-xs text-muted-foreground font-normal ml-1">
              +
            </span>
          )}
        </p>
      </div>
    </Card>
  );
}
