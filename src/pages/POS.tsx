import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ProductCard from "@/components/ProductCard";
import Cart from "@/components/Cart";
import { Product, CartItem, getAllProducts, getProduct, initializeSampleData, addTransaction } from "@/lib/db";
import { LayoutGrid, Package, Search, Barcode } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useNavigate } from "react-router-dom";

export default function POS() {
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [customerEmail, setCustomerEmail] = useState("");
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => {
    filterProducts();
  }, [products, searchQuery, selectedCategory]);

  const loadProducts = async () => {
    await initializeSampleData();
    const allProducts = await getAllProducts();
    setProducts(allProducts);
  };

  const filterProducts = () => {
    let filtered = products;

    if (selectedCategory !== "All") {
      filtered = filtered.filter(p => p.category === selectedCategory);
    }

    if (searchQuery) {
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.barcode?.includes(searchQuery)
      );
    }

    setFilteredProducts(filtered);
  };

  const categories = ["All", ...new Set(products.map(p => p.category))];

  const handleAddToCart = async (productId: string, variantId: string) => {
    const product = await getProduct(productId);
    if (!product) return;

    const variant = product.variants.find(v => v.id === variantId);
    if (!variant || variant.stock === 0) {
      toast({
        title: "Out of stock",
        description: "This item is currently unavailable.",
        variant: "destructive",
      });
      return;
    }

    const existingItem = cart.find(
      item => item.productId === productId && item.variantId === variantId
    );

    if (existingItem) {
      if (existingItem.quantity >= variant.stock) {
        toast({
          title: "Stock limit reached",
          description: `Only ${variant.stock} available.`,
          variant: "destructive",
        });
        return;
      }
      setCart(cart.map(item =>
        item.productId === productId && item.variantId === variantId
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      setCart([...cart, { productId, variantId, quantity: 1, price: variant.price }]);
    }

    toast({
      title: "Added to cart",
      description: `${product.name} added successfully.`,
    });
  };

  const handleUpdateQuantity = async (productId: string, variantId: string, change: number) => {
    const product = await getProduct(productId);
    if (!product) return;

    const variant = product.variants.find(v => v.id === variantId);
    if (!variant) return;

    const item = cart.find(i => i.productId === productId && i.variantId === variantId);
    if (!item) return;

    const newQuantity = item.quantity + change;

    if (newQuantity === 0) {
      handleRemoveItem(productId, variantId);
      return;
    }

    if (newQuantity > variant.stock) {
      toast({
        title: "Stock limit",
        description: `Only ${variant.stock} available.`,
        variant: "destructive",
      });
      return;
    }

    setCart(cart.map(i =>
      i.productId === productId && i.variantId === variantId
        ? { ...i, quantity: newQuantity }
        : i
    ));
  };

  const handleRemoveItem = (productId: string, variantId: string) => {
    setCart(cart.filter(i => !(i.productId === productId && i.variantId === variantId)));
  };

  const handleCheckout = () => {
    if (cart.length === 0) return;
    setCheckoutOpen(true);
  };

  const handleCompleteCheckout = async () => {
    const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    
    await addTransaction({
      id: `TXN-${Date.now()}`,
      items: cart,
      total,
      customerEmail: customerEmail || undefined,
      timestamp: Date.now(),
    });

    toast({
      title: "Sale completed!",
      description: `Total: $${total.toFixed(2)}${customerEmail ? ' - Receipt sent' : ''}`,
    });

    setCart([]);
    setCustomerEmail("");
    setCheckoutOpen(false);
    
    // Reload products to update stock
    await loadProducts();
  };

  const cartWithProducts = cart.map(item => ({
    ...item,
    product: products.find(p => p.id === item.productId)!,
  })).filter(item => item.product);

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-primary to-primary-glow p-2 rounded-lg">
              <Package className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Persona POS</h1>
              <p className="text-xs text-muted-foreground">Point of Sale</p>
            </div>
          </div>
          <Button 
            variant="outline" 
            onClick={() => navigate('/inventory')}
            className="border-border"
          >
            <LayoutGrid className="w-4 h-4" />
            Inventory
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Products Panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Search & Filters */}
          <div className="p-4 border-b border-border bg-card">
            <div className="flex gap-3 mb-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search products or scan barcode..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 bg-background border-border"
                />
              </div>
              <Button variant="outline" size="icon" className="border-border">
                <Barcode className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {categories.map(category => (
                <Badge
                  key={category}
                  variant={selectedCategory === category ? "default" : "outline"}
                  className="cursor-pointer whitespace-nowrap"
                  onClick={() => setSelectedCategory(category)}
                >
                  {category}
                </Badge>
              ))}
            </div>
          </div>

          {/* Products Grid */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {filteredProducts.map(product => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onAddToCart={handleAddToCart}
                />
              ))}
            </div>
            {filteredProducts.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Package className="w-16 h-16 text-muted-foreground/30 mb-4" />
                <p className="text-muted-foreground">No products found</p>
              </div>
            )}
          </div>
        </div>

        {/* Cart Panel */}
        <div className="w-96 border-l border-border bg-card hidden lg:block">
          <Cart
            items={cartWithProducts}
            onUpdateQuantity={handleUpdateQuantity}
            onRemoveItem={handleRemoveItem}
            onCheckout={handleCheckout}
          />
        </div>
      </div>

      {/* Mobile Cart Button */}
      <div className="lg:hidden fixed bottom-4 right-4 z-50">
        <Button 
          size="lg" 
          className="rounded-full shadow-lg bg-primary hover:bg-primary/90 text-primary-foreground"
          onClick={handleCheckout}
        >
          Cart ({cart.length})
        </Button>
      </div>

      {/* Checkout Dialog */}
      <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Complete Sale</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Enter customer details to send a receipt (optional)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-foreground">Customer Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="customer@example.com"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="bg-background border-border"
              />
            </div>
            <div className="bg-secondary/30 p-4 rounded-lg border border-border">
              <div className="flex justify-between items-center">
                <span className="text-lg font-semibold text-foreground">Total</span>
                <span className="text-2xl font-bold text-primary">
                  ${cart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2)}
                </span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckoutOpen(false)} className="border-border">
              Cancel
            </Button>
            <Button onClick={handleCompleteCheckout} className="bg-primary hover:bg-primary/90 text-primary-foreground">
              Complete Sale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
