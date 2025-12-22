import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ProductCard from "@/components/ProductCard";
import Cart from "@/components/Cart";
import VariantPicker from "@/components/VariantPicker";
import ReceiptDialog from "@/components/ReceiptDialog";
import { CartItem } from "@/lib/db";
import { apiClient } from "@/lib/api-client";
import type { Product, CreateOrderRequest, Order } from "@/lib/api-types";
import { LayoutGrid, Package, Search, Barcode, FileBarChart, Settings as SettingsIcon, ShieldCheck, Briefcase } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useNavigate } from "react-router-dom";

export default function POS() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [customerEmail, setCustomerEmail] = useState("");
  const [variantPickerOpen, setVariantPickerOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false);
  const [lastOrderId, setLastOrderId] = useState("");
  const [lastOrderTotal, setLastOrderTotal] = useState(0);
  const [categories, setCategories] = useState<string[]>(["All"]);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    loadProducts();
    loadCategories();
  }, []);

  useEffect(() => {
    filterProducts();
  }, [products, searchQuery, selectedCategory]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        barcodeRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const loadProducts = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<{ success: boolean; data: Product[] }>('/api/products');
      if (response.success) {
        setProducts(response.data);
        // Extract unique categories from products
        const uniqueCategories = new Set(response.data.map(p => p.category).filter(Boolean));
        setCategories(["All", ...Array.from(uniqueCategories)]);
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to load products',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    // Categories are now derived from products in loadProducts
    // This function is kept for compatibility but does nothing
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

  const handleBarcodeSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!barcodeInput.trim()) return;

    // Try to find product by barcode in loaded products
    const product = products.find(p => 
      p.barcode === barcodeInput.trim() ||
      p.variants.some(v => v.barcode === barcodeInput.trim())
    );
    
    if (product) {
      // Find variant with matching barcode
      const variant = product.variants.find(v => v.barcode === barcodeInput.trim()) || product.variants[0];
      if (variant) {
        await handleAddToCart(product.id, variant.id);
        setBarcodeInput("");
        barcodeRef.current?.focus();
      } else {
        toast({ title: "Variant not found", variant: "destructive" });
      }
    } else {
      toast({ title: "Product not found", variant: "destructive" });
    }
  };

  const handleProductClick = (product: Product) => {
    // Consider only in-stock variants when deciding if a picker is needed
    const inStockVariants = product.variants.filter((v) => v.stock > 0);
    const uniqueSizes = new Set(inStockVariants.map((v) => v.size).filter(Boolean));
    const uniqueColors = new Set(inStockVariants.map((v) => v.color).filter(Boolean));

    const hasChoice = uniqueSizes.size > 1 || uniqueColors.size > 1; // true only if user has something to choose

    // Debug logging removed - use logger.debug() if needed

    if (!hasChoice || inStockVariants.length === 1) {
      // No real choices (or exactly one in-stock variant) -> add directly
      const chosen = (inStockVariants[0] ?? product.variants[0]);
      if (chosen) handleAddToCart(product.id, chosen.id);
      return;
    }

    // There are multiple sizes/colors to choose -> show picker
    setSelectedProduct(product);
    setVariantPickerOpen(true);
  };

  const handleAddToCart = async (productId: string, variantId: string) => {
    const product = products.find(p => p.id === productId);
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

    // Calculate price (use variant priceOverride or priceDelta, or basePrice)
    const price = variant.priceOverride ?? (product.basePrice + (variant.priceDelta || 0));

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
      setCart([...cart, { productId, variantId, quantity: 1, price, nameSnapshot: product.name, size: variant.size, color: variant.color }]);
    }

    // ARIA live region announcement
    const announcement = document.getElementById('cart-announcement');
    if (announcement) {
      announcement.textContent = `${product.name} added to cart`;
    }

    toast({
      title: "Added to cart",
      description: `${product.name} added successfully.`,
    });
  };

  const handleUpdateQuantity = async (productId: string, variantId: string, change: number) => {
    const product = products.find(p => p.id === productId);
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
    try {
      // TODO: Get settings from API when settings endpoint is available
      const taxRate = 0; // Default to 0 for now
      
      const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const discountTotal = cart.reduce((sum, item) => sum + (item.lineDiscount || 0) * item.quantity, 0);
      const taxTotal = (subtotal - discountTotal) * taxRate;
      const total = subtotal - discountTotal + taxTotal;
      
      const orderData: CreateOrderRequest = {
        items: cart.map(item => ({
          productId: item.productId,
          variantId: item.variantId,
          nameSnapshot: item.nameSnapshot || '',
          size: item.size,
          color: item.color,
          quantity: item.quantity,
          unitPrice: item.price,
          lineDiscount: item.lineDiscount || 0,
          lineTotal: item.price * item.quantity - (item.lineDiscount || 0) * item.quantity,
          notes: item.notes,
        })),
        subtotal,
        discountTotal,
        taxTotal,
        total,
        paymentMethod: 'Cash',
        // Customer information is optional - only include if provided and not empty
        ...(customerEmail && customerEmail.trim() ? { customerEmail: customerEmail.trim() } : {}),
      };

      const response = await apiClient.post<{ success: boolean; data: Order }>('/api/orders', orderData);
      
      if (response.success) {
        toast({
          title: "Sale completed!",
          description: `Order ${response.data.id} saved successfully`,
        });

        setLastOrderId(response.data.id);
        setLastOrderTotal(total);
        setCart([]);
        setCustomerEmail("");
        setCheckoutOpen(false);
        setReceiptDialogOpen(true);
        
        // Reload products to update stock
        await loadProducts();
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || 'Failed to create order',
        variant: 'destructive',
      });
    }
  };

  const cartWithProducts = cart.map(item => ({
    ...item,
    product: products.find(p => p.id === item.productId)!,
  })).filter(item => item.product);

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* ARIA live region for cart announcements */}
      <div id="cart-announcement" className="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>

      {/* Header */}
      <header className="border-b border-border bg-card px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-primary to-primary-glow p-2 rounded-lg">
              <Package className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Persona POS</h1>
              <p className="text-xs text-muted-foreground">{new Date().toLocaleTimeString()}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={() => navigate('/services')}
              className="border-border"
              size="sm"
            >
              <Briefcase className="w-4 h-4 mr-1" />
              Services
            </Button>
            <Button 
              variant="outline" 
              onClick={() => navigate('/inventory')}
              className="border-border"
              size="sm"
            >
              <LayoutGrid className="w-4 h-4 mr-1" />
              Inventory
            </Button>
            <Button 
              variant="outline" 
              onClick={() => navigate('/reports')}
              className="border-border"
              size="sm"
            >
              <FileBarChart className="w-4 h-4 mr-1" />
              Reports
            </Button>
            <Button 
              variant="outline" 
              onClick={() => navigate('/settings')}
              className="border-border"
              size="sm"
            >
              <SettingsIcon className="w-4 h-4 mr-1" />
              Settings
            </Button>
            <Button 
              variant="default" 
              onClick={() => navigate('/login')}
              className="bg-primary hover:bg-primary/90"
              size="sm"
            >
              <ShieldCheck className="w-4 h-4 mr-1" />
              Admin
            </Button>
          </div>
        </div>

        {/* Barcode Input Row */}
        <div className="mt-3">
          <form onSubmit={handleBarcodeSubmit} className="flex gap-2">
            <div className="flex-1 relative">
              <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                ref={barcodeRef}
                placeholder="Scan or enter barcode (press / to focus)"
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                className="pl-9 bg-background border-border"
                autoFocus
              />
            </div>
            <Button type="submit" variant="outline" className="border-border">
              Add
            </Button>
          </form>
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
                  onClick={() => handleProductClick(product)}
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

      {/* Variant Picker */}
      {selectedProduct && (
        <VariantPicker
          product={selectedProduct}
          open={variantPickerOpen}
          onClose={() => {
            setVariantPickerOpen(false);
            setSelectedProduct(null);
          }}
          onAddToCart={handleAddToCart}
        />
      )}

      {/* Receipt Dialog */}
      <ReceiptDialog
        open={receiptDialogOpen}
        onClose={() => setReceiptDialogOpen(false)}
        orderId={lastOrderId}
        total={lastOrderTotal}
      />

      {/* Checkout Dialog */}
      <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Complete Sale</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Customer information is optional. Leave blank for walk-in customers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-foreground">
                Customer Email <span className="text-muted-foreground text-xs font-normal">(Optional)</span>
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="customer@example.com (optional)"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="bg-background border-border"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to complete sale without customer information
              </p>
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
