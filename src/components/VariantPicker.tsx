import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Product, ProductVariant, calculateVariantPrice } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart } from "lucide-react";

interface VariantPickerProps {
  product: Product;
  open: boolean;
  onClose: () => void;
  onAddToCart: (productId: string, variantId: string) => void;
}

export default function VariantPicker({ product, open, onClose, onAddToCart }: VariantPickerProps) {
  const [selectedSize, setSelectedSize] = useState<string | undefined>();
  const [selectedColor, setSelectedColor] = useState<string | undefined>();

  const sizes = [...new Set(product.variants.filter(v => v.enabled && v.size).map(v => v.size as string))];
  const colors = [...new Set(product.variants.filter(v => v.enabled && v.color).map(v => v.color as string))];

  // Auto-select defaults when only one option exists
  useEffect(() => {
    if (sizes.length === 1 && !selectedSize) setSelectedSize(sizes[0]);
    if (colors.length === 1 && !selectedColor) setSelectedColor(colors[0]);
  }, [product.id, open, sizes.length, colors.length]);

  // Find matching variant based on current selections
  const matchingVariant = product.variants.find(v => {
    if (!v.enabled) return false;
    if (sizes.length > 1 && !selectedSize) return false; // require size when multiple
    if (colors.length > 1 && !selectedColor) return false; // require color when multiple
    if (sizes.length > 0 && selectedSize && v.size !== selectedSize) return false;
    if (colors.length > 0 && selectedColor && v.color !== selectedColor) return false;
    return true;
  });

  const displayPrice = matchingVariant 
    ? calculateVariantPrice(product.basePrice, matchingVariant)
    : product.basePrice;

  const canAdd = matchingVariant && matchingVariant.stock > 0;

  const handleAdd = () => {
    if (matchingVariant) {
      onAddToCart(product.id, matchingVariant.id);
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground text-xl">{product.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Price Display */}
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-1">Price</p>
            <p className="text-3xl font-bold text-primary">${displayPrice.toFixed(2)}</p>
          </div>

          {/* Size Selection */}
          {sizes.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Size</p>
              <div className="flex flex-wrap gap-2">
                {sizes.map(size => (
                  <Button
                    key={size}
                    variant={selectedSize === size ? "default" : "outline"}
                    onClick={() => setSelectedSize(size)}
                    className="min-w-[60px]"
                  >
                    {size}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Color Selection */}
          {colors.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Color</p>
              <div className="flex flex-wrap gap-2">
                {colors.map(color => (
                  <Button
                    key={color}
                    variant={selectedColor === color ? "default" : "outline"}
                    onClick={() => setSelectedColor(color)}
                    className="min-w-[80px]"
                  >
                    {color}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Stock Info */}
          {matchingVariant && (
            <div className="text-center">
              <Badge variant={matchingVariant.stock > 0 ? "default" : "destructive"}>
                {matchingVariant.stock > 0 ? `${matchingVariant.stock} in stock` : 'Out of stock'}
              </Badge>
            </div>
          )}

          {/* Add Button */}
          <Button
            onClick={handleAdd}
            disabled={!canAdd}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
            size="lg"
          >
            <ShoppingCart className="w-4 h-4 mr-2" />
            Add to Cart
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
