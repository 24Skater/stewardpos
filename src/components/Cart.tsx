import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CartItem, Product } from "@/lib/db";
import { Minus, Plus, Trash2, ShoppingBag } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

interface CartProps {
  items: (CartItem & { product: Product })[];
  onUpdateQuantity: (productId: string, variantId: string, change: number) => void;
  onRemoveItem: (productId: string, variantId: string) => void;
  onCheckout: () => void;
}

export default function Cart({ items, onUpdateQuantity, onRemoveItem, onCheckout }: CartProps) {
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <Card className="flex flex-col h-full bg-card border-border">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <ShoppingBag className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Current Order</h2>
          {itemCount > 0 && (
            <span className="ml-auto bg-primary text-primary-foreground text-xs font-bold px-2 py-1 rounded-full">
              {itemCount}
            </span>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 p-4">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <ShoppingBag className="w-16 h-16 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground">Cart is empty</p>
            <p className="text-sm text-muted-foreground/70 mt-1">Add items to get started</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const variant = item.product.variants.find(v => v.id === item.variantId);
              return (
                <Card key={`${item.productId}-${item.variantId}`} className="p-3 bg-secondary/30 border-border">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm text-foreground truncate">
                        {item.product.name}
                      </h4>
                      {variant && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {variant.size && `Size: ${variant.size}`}
                          {variant.size && variant.color && ' • '}
                          {variant.color && `Color: ${variant.color}`}
                        </p>
                      )}
                      <p className="text-sm font-semibold text-primary mt-1">
                        ${item.price.toFixed(2)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => onRemoveItem(item.productId, item.variantId)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 border-border"
                      onClick={() => onUpdateQuantity(item.productId, item.variantId, -1)}
                    >
                      <Minus className="w-3 h-3" />
                    </Button>
                    <span className="text-sm font-medium min-w-[2rem] text-center text-foreground">
                      {item.quantity}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 border-border"
                      onClick={() => onUpdateQuantity(item.productId, item.variantId, 1)}
                    >
                      <Plus className="w-3 h-3" />
                    </Button>
                    <span className="ml-auto text-sm font-semibold text-foreground">
                      ${(item.price * item.quantity).toFixed(2)}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <div className="p-4 border-t border-border space-y-3 bg-secondary/20">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="font-semibold text-foreground">${total.toFixed(2)}</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <span className="text-lg font-semibold text-foreground">Total</span>
          <span className="text-2xl font-bold text-primary">${total.toFixed(2)}</span>
        </div>
        <Button 
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
          size="lg"
          disabled={items.length === 0}
          onClick={onCheckout}
        >
          Checkout
        </Button>
      </div>
    </Card>
  );
}
