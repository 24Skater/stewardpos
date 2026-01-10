import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ProductCard from "@/components/ProductCard";
import Cart from "@/components/Cart";
import VariantPicker from "@/components/VariantPicker";
import ReceiptDialog from "@/components/ReceiptDialog";
import Logo from "@/components/Logo";
import { CartItem } from "@/lib/db";
import { apiClient } from "@/lib/api-client";
import type { Product, CreateOrderRequest, Order } from "@/lib/api-types";
import { LayoutGrid, Package, Search, Barcode, FileBarChart, Settings as SettingsIcon, ShieldCheck, Briefcase, Tag, X, Percent, DollarSign, Gift, CheckCircle2, UserCheck, Shield, GraduationCap, Heart, Cake, AlertTriangle, RotateCcw } from "lucide-react";
import QuickReturnDialog from "@/components/QuickReturnDialog";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNavigate } from "react-router-dom";

interface DiscountType {
  id: string;
  name: string;
  code?: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  color: string;
  icon?: string;
  requiresApproval: boolean;
}

interface AppliedDiscount {
  source: 'quick_discount' | 'promo_code' | 'manual' | 'employee';
  id?: string;
  code?: string;
  name: string;
  type: 'percentage' | 'fixed';
  value: number;
  amount: number;
}

const iconMap: Record<string, any> = {
  'user': UserCheck,
  'shield': Shield,
  'graduation-cap': GraduationCap,
  'heart': Heart,
  'cake': Cake,
  'alert-triangle': AlertTriangle,
};

const colorMap: Record<string, string> = {
  'blue': 'bg-blue-500 hover:bg-blue-600',
  'green': 'bg-green-500 hover:bg-green-600',
  'purple': 'bg-purple-500 hover:bg-purple-600',
  'red': 'bg-red-500 hover:bg-red-600',
  'pink': 'bg-pink-500 hover:bg-pink-600',
  'orange': 'bg-orange-500 hover:bg-orange-600',
  'gray': 'bg-gray-500 hover:bg-gray-600',
};

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
  const [lastOrderSubtotal, setLastOrderSubtotal] = useState(0);
  const [lastOrderTax, setLastOrderTax] = useState(0);
  const [lastOrderDiscount, setLastOrderDiscount] = useState(0);
  const [lastOrderPaymentMethod, setLastOrderPaymentMethod] = useState("");
  const [lastOrderItems, setLastOrderItems] = useState<CartItem[]>([]);
  const [categories, setCategories] = useState<string[]>(["All"]);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const navigate = useNavigate();
  
  // Discount state
  const [quickDiscounts, setQuickDiscounts] = useState<DiscountType[]>([]);
  const [appliedDiscounts, setAppliedDiscounts] = useState<AppliedDiscount[]>([]);
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [manualDiscountType, setManualDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [manualDiscountValue, setManualDiscountValue] = useState("");
  const [manualDiscountReason, setManualDiscountReason] = useState("");
  
  // Return dialog state
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  
  // Store branding
  const [storeName, setStoreName] = useState("POS");
  const [storeLogo, setStoreLogo] = useState<string | null>(null);

  useEffect(() => {
    loadProducts();
    loadCategories();
    loadQuickDiscounts();
    loadStoreName();
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

  const loadStoreName = async () => {
    try {
      const response = await apiClient.get<{ success: boolean; data: { storeName?: string; logoUrl?: string } }>('/api/admin/settings');
      if (response.success && response.data) {
        if (response.data.storeName) {
          setStoreName(response.data.storeName);
        }
        if (response.data.logoUrl) {
          setStoreLogo(response.data.logoUrl);
        }
      }
    } catch (error) {
      // Use default name if settings fail to load
      console.warn('Could not load store branding');
    }
  };

  const loadQuickDiscounts = async () => {
    try {
      const response = await apiClient.get<{ success: boolean; data: DiscountType[] }>('/api/discounts/types/pos');
      if (response.success) {
        setQuickDiscounts(response.data);
      }
    } catch (error) {
      // Non-critical, silently fail
      console.warn('Failed to load quick discounts:', error);
    }
  };

  const calculateSubtotal = () => {
    return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  };

  const calculateDiscountAmount = (discount: AppliedDiscount, subtotal: number) => {
    if (discount.type === 'percentage') {
      return subtotal * (discount.value / 100);
    }
    return Math.min(discount.value, subtotal);
  };

  const getTotalDiscount = () => {
    const subtotal = calculateSubtotal();
    return appliedDiscounts.reduce((total, discount) => {
      return total + calculateDiscountAmount(discount, subtotal - total);
    }, 0);
  };

  const applyQuickDiscount = (discount: DiscountType) => {
    // Check if already applied
    if (appliedDiscounts.some(d => d.source === 'quick_discount' && d.id === discount.id)) {
      toast({ title: 'Discount already applied', variant: 'destructive' });
      return;
    }

    const subtotal = calculateSubtotal();
    const currentDiscount = getTotalDiscount();
    const remainingSubtotal = subtotal - currentDiscount;
    const discountAmount = discount.discountType === 'percentage' 
      ? remainingSubtotal * (discount.discountValue / 100)
      : Math.min(discount.discountValue, remainingSubtotal);

    setAppliedDiscounts([...appliedDiscounts, {
      source: 'quick_discount',
      id: discount.id,
      code: discount.code,
      name: discount.name,
      type: discount.discountType,
      value: discount.discountValue,
      amount: discountAmount,
    }]);

    toast({ title: `${discount.name} applied`, description: `-$${discountAmount.toFixed(2)}` });
  };

  const applyPromoCode = async () => {
    if (!promoCodeInput.trim()) return;

    setPromoLoading(true);
    try {
      const subtotal = calculateSubtotal();
      const response = await apiClient.post<{ success: boolean; valid: boolean; message?: string; promo?: any }>(
        '/api/discounts/promos/validate',
        {
          code: promoCodeInput.trim().toUpperCase(),
          cartTotal: subtotal,
          itemCount: cart.reduce((sum, item) => sum + item.quantity, 0),
        }
      );

      if (response.success && response.valid && response.promo) {
        // Check if already applied
        if (appliedDiscounts.some(d => d.source === 'promo_code' && d.id === response.promo.id)) {
          toast({ title: 'Promo code already applied', variant: 'destructive' });
          return;
        }

        setAppliedDiscounts([...appliedDiscounts, {
          source: 'promo_code',
          id: response.promo.id,
          code: response.promo.code,
          name: response.promo.name,
          type: response.promo.discountType,
          value: response.promo.discountValue,
          amount: response.promo.discountAmount,
        }]);

        setPromoCodeInput("");
        toast({ 
          title: 'Promo code applied!', 
          description: `${response.promo.name} - $${response.promo.discountAmount.toFixed(2)} off` 
        });
      } else {
        toast({ title: response.message || 'Invalid promo code', variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Failed to validate promo code', description: error.message, variant: 'destructive' });
    } finally {
      setPromoLoading(false);
    }
  };

  const applyManualDiscount = () => {
    const value = parseFloat(manualDiscountValue);
    if (isNaN(value) || value <= 0) {
      toast({ title: 'Please enter a valid discount amount', variant: 'destructive' });
      return;
    }

    if (manualDiscountType === 'percentage' && value > 100) {
      toast({ title: 'Percentage cannot exceed 100%', variant: 'destructive' });
      return;
    }

    const subtotal = calculateSubtotal();
    const currentDiscount = getTotalDiscount();
    const remainingSubtotal = subtotal - currentDiscount;
    const discountAmount = manualDiscountType === 'percentage' 
      ? remainingSubtotal * (value / 100)
      : Math.min(value, remainingSubtotal);

    setAppliedDiscounts([...appliedDiscounts, {
      source: 'manual',
      name: manualDiscountReason || 'Manual Discount',
      type: manualDiscountType,
      value: value,
      amount: discountAmount,
    }]);

    setManualDiscountValue("");
    setManualDiscountReason("");
    toast({ title: 'Manual discount applied', description: `-$${discountAmount.toFixed(2)}` });
  };

  const removeDiscount = (index: number) => {
    setAppliedDiscounts(appliedDiscounts.filter((_, i) => i !== index));
  };

  const clearAllDiscounts = () => {
    setAppliedDiscounts([]);
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
      
      const subtotal = calculateSubtotal();
      const discountTotal = getTotalDiscount();
      const taxTotal = (subtotal - discountTotal) * taxRate;
      const total = subtotal - discountTotal + taxTotal;
      
      const orderData: CreateOrderRequest = {
        items: cart.map(item => {
          const orderItem: any = {
            productId: item.productId,
            nameSnapshot: item.nameSnapshot || '',
            quantity: item.quantity,
            unitPrice: item.price,
            lineDiscount: item.lineDiscount || 0,
            lineTotal: item.price * item.quantity - (item.lineDiscount || 0) * item.quantity,
          };
          
          // Only include optional fields if they have valid values
          if (item.variantId) orderItem.variantId = item.variantId;
          if (item.size) orderItem.size = item.size;
          if (item.color) orderItem.color = item.color;
          if (item.notes) orderItem.notes = item.notes;
          
          return orderItem;
        }),
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
        // Log discount usage for each applied discount
        for (const discount of appliedDiscounts) {
          try {
            await apiClient.post('/api/discounts/usage', {
              orderId: response.data.id,
              discountSource: discount.source,
              discountTypeId: discount.source === 'quick_discount' ? discount.id : undefined,
              promoCodeId: discount.source === 'promo_code' ? discount.id : undefined,
              discountCode: discount.code,
              discountName: discount.name,
              discountType: discount.type,
              discountValue: discount.value,
              discountAmount: discount.amount,
              customerEmail: customerEmail || undefined,
            });

            // Increment promo code usage if applicable
            if (discount.source === 'promo_code' && discount.id) {
              await apiClient.post(`/api/discounts/promos/${discount.id}/use`);
            }
          } catch (error) {
            console.error('Failed to log discount usage:', error);
          }
        }

        toast({
          title: "Sale completed!",
          description: `Order ${response.data.id} saved successfully`,
        });

        setLastOrderId(response.data.id);
        setLastOrderTotal(total);
        setLastOrderSubtotal(subtotal);
        setLastOrderTax(taxTotal);
        setLastOrderDiscount(discountTotal);
        setLastOrderPaymentMethod('Cash');
        setLastOrderItems([...cart]);
        setCart([]);
        setCustomerEmail("");
        setAppliedDiscounts([]);
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
            {storeLogo ? (
              <img 
                src={storeLogo} 
                alt={storeName} 
                className="h-10 w-auto max-w-[120px] object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <>
                <Logo responsive className="hidden md:block" />
                <Logo variant="icon" className="md:hidden" />
              </>
            )}
            <div className={storeLogo ? "" : "hidden md:block"}>
              {storeLogo && <h1 className="text-xl font-bold text-foreground">{storeName}</h1>}
              <p className="text-xs text-muted-foreground">{new Date().toLocaleTimeString()}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={() => setReturnDialogOpen(true)}
              className="border-orange-500 text-orange-600 hover:bg-orange-50"
              size="sm"
            >
              <RotateCcw className="w-4 h-4 mr-1" />
              Returns
            </Button>
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
        subtotal={lastOrderSubtotal}
        tax={lastOrderTax}
        discount={lastOrderDiscount}
        paymentMethod={lastOrderPaymentMethod}
        items={lastOrderItems.map(item => ({
          id: item.id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          size: item.size,
          color: item.color,
        }))}
      />

      {/* Checkout Dialog */}
      <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <DialogContent className="bg-card border-border max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">Complete Sale</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Apply discounts and complete the transaction
            </DialogDescription>
          </DialogHeader>
          
          <Tabs defaultValue="discounts" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="discounts">
                <Tag className="w-4 h-4 mr-2" />
                Discounts
              </TabsTrigger>
              <TabsTrigger value="promo">
                <Gift className="w-4 h-4 mr-2" />
                Promo Code
              </TabsTrigger>
              <TabsTrigger value="customer">
                <UserCheck className="w-4 h-4 mr-2" />
                Customer
              </TabsTrigger>
            </TabsList>

            {/* Quick Discounts Tab */}
            <TabsContent value="discounts" className="mt-4 space-y-4">
              <div>
                <Label className="text-sm font-medium mb-2 block">Quick Discounts</Label>
                <div className="grid grid-cols-3 gap-2">
                  {quickDiscounts.map((discount) => {
                    const IconComponent = iconMap[discount.icon || ''] || Tag;
                    return (
                      <Button
                        key={discount.id}
                        variant="outline"
                        className={`h-auto flex-col py-3 ${colorMap[discount.color] || ''} ${appliedDiscounts.some(d => d.id === discount.id) ? 'ring-2 ring-green-500' : ''}`}
                        onClick={() => applyQuickDiscount(discount)}
                        disabled={appliedDiscounts.some(d => d.id === discount.id)}
                      >
                        <IconComponent className="w-5 h-5 mb-1 text-white" />
                        <span className="text-xs text-white font-medium">{discount.name}</span>
                        <span className="text-sm font-bold text-white">
                          {discount.discountType === 'percentage' ? `${discount.discountValue}%` : `$${discount.discountValue}`}
                        </span>
                      </Button>
                    );
                  })}
                  {quickDiscounts.length === 0 && (
                    <p className="text-sm text-muted-foreground col-span-3 text-center py-4">
                      No quick discounts available
                    </p>
                  )}
                </div>
              </div>

              <div className="border-t pt-4">
                <Label className="text-sm font-medium mb-2 block">Manual Discount</Label>
                <div className="flex gap-2">
                  <div className="flex-1 flex gap-2">
                    <Button
                      variant={manualDiscountType === 'percentage' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setManualDiscountType('percentage')}
                    >
                      <Percent className="w-4 h-4" />
                    </Button>
                    <Button
                      variant={manualDiscountType === 'fixed' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setManualDiscountType('fixed')}
                    >
                      <DollarSign className="w-4 h-4" />
                    </Button>
                    <Input
                      type="number"
                      placeholder={manualDiscountType === 'percentage' ? '10' : '5.00'}
                      value={manualDiscountValue}
                      onChange={(e) => setManualDiscountValue(e.target.value)}
                      className="w-24"
                    />
                    <Input
                      placeholder="Reason (optional)"
                      value={manualDiscountReason}
                      onChange={(e) => setManualDiscountReason(e.target.value)}
                      className="flex-1"
                    />
                  </div>
                  <Button onClick={applyManualDiscount} disabled={!manualDiscountValue}>
                    Apply
                  </Button>
                </div>
              </div>
            </TabsContent>

            {/* Promo Code Tab */}
            <TabsContent value="promo" className="mt-4 space-y-4">
              <div>
                <Label className="text-sm font-medium mb-2 block">Enter Promo Code</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="SAVE20"
                    value={promoCodeInput}
                    onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && applyPromoCode()}
                    className="flex-1 uppercase"
                  />
                  <Button onClick={applyPromoCode} disabled={promoLoading || !promoCodeInput.trim()}>
                    {promoLoading ? 'Validating...' : 'Apply'}
                  </Button>
                </div>
              </div>
            </TabsContent>

            {/* Customer Tab */}
            <TabsContent value="customer" className="mt-4 space-y-4">
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
            </TabsContent>
          </Tabs>

          {/* Applied Discounts */}
          {appliedDiscounts.length > 0 && (
            <div className="border-t pt-4">
              <div className="flex justify-between items-center mb-2">
                <Label className="text-sm font-medium">Applied Discounts</Label>
                <Button variant="ghost" size="sm" onClick={clearAllDiscounts} className="text-xs text-destructive">
                  Clear All
                </Button>
              </div>
              <div className="space-y-2">
                {appliedDiscounts.map((discount, index) => (
                  <div key={index} className="flex items-center justify-between bg-secondary/30 px-3 py-2 rounded-md">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      <span className="text-sm font-medium">{discount.name}</span>
                      {discount.code && (
                        <code className="text-xs bg-muted px-1 rounded">{discount.code}</code>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-green-600 font-bold">
                        -{discount.type === 'percentage' ? `${discount.value}%` : `$${discount.amount.toFixed(2)}`}
                      </span>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6"
                        onClick={() => removeDiscount(index)}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Order Summary */}
          <div className="bg-secondary/30 p-4 rounded-lg border border-border mt-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>${calculateSubtotal().toFixed(2)}</span>
              </div>
              {getTotalDiscount() > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>Discount</span>
                  <span>-${getTotalDiscount().toFixed(2)}</span>
                </div>
              )}
              <div className="border-t pt-2 flex justify-between items-center">
                <span className="text-lg font-semibold text-foreground">Total</span>
                <span className="text-2xl font-bold text-primary">
                  ${(calculateSubtotal() - getTotalDiscount()).toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckoutOpen(false)} className="border-border">
              Cancel
            </Button>
            <Button onClick={handleCompleteCheckout} className="bg-primary hover:bg-primary/90 text-primary-foreground">
              Complete Sale - ${(calculateSubtotal() - getTotalDiscount()).toFixed(2)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Return Dialog */}
      <QuickReturnDialog
        open={returnDialogOpen}
        onClose={() => setReturnDialogOpen(false)}
        onComplete={() => loadProducts()}
      />
    </div>
  );
}
