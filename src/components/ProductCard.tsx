import { Card } from "@/components/ui/card";
import { Product } from "@/lib/db";
import { ShoppingCart } from "lucide-react";

interface ProductCardProps {
  product: Product;
  onClick?: () => void;
}

export default function ProductCard({ product, onClick }: ProductCardProps) {
  const defaultVariant = product.variants[0];
  const inStock = product.variants.some(v => v.stock > 0);

  return (
    <Card 
      className="group overflow-hidden bg-card hover:shadow-lg transition-all duration-300 cursor-pointer border-border"
      onClick={() => inStock && onClick?.()}
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
