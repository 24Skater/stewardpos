import { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ProductCard from "@/components/ProductCard";
import Cart from "@/components/Cart";
import VariantPicker from "@/components/VariantPicker";
import ReceiptDialog from "@/components/ReceiptDialog";
import { discountsApi, ordersApi, terminalApi } from "@/lib/api";
import type {
  CartItem,
  CreateOrderRequest,
  DiscountType as ApiDiscountType,
  Order,
  PaymentMethodsConfig,
  Product,
  ValidatedPromo,
} from "@/lib/api";
import { useCreateOrder, useProducts, useSettings } from "@/hooks/queries";
import { logger } from "@/lib/logger";
import { LayoutGrid, Package, Search, Barcode, FileBarChart, Settings as SettingsIcon, ShieldCheck, Briefcase, Tag, X, Percent, DollarSign, Gift, CheckCircle2, UserCheck, Shield, GraduationCap, Heart, Cake, AlertTriangle, RotateCcw, Banknote, Smartphone, CreditCard, Loader2, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import QuickReturnDialog from "@/components/QuickReturnDialog";
import CashDrawerDialog from "@/components/CashDrawerDialog";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNavigate } from "react-router-dom";
import { getErrorMessage } from '@/lib/errors';

const CARD_PROVIDER_LABELS: Record<string, string> = {
  square: 'Square',
  stripe: 'Stripe Terminal',
  clover: 'Clover',
  paypal: 'PayPal Here',
  dejavoo: 'Dejavoo',
  verifone: 'Verifone',
  generic: 'Card Reader',
};

/**
 * A quick-discount chip the register can actually price.
 *
 * The catalog also supports `buy_x_get_y`, which needs line-level logic this
 * screen does not have, so those are filtered out at load rather than rendered
 * as a chip that would compute the wrong amount.
 */
type PosDiscountType = Omit<ApiDiscountType, 'discountType'> & {
  discountType: 'percentage' | 'fixed';
};

interface AppliedDiscount {
  source: 'quick_discount' | 'promo_code' | 'manual' | 'employee';
  id?: string;
  code?: string;
  name: string;
  type: 'percentage' | 'fixed';
  value: number;
  amount: number;
}

const iconMap: Record<string, LucideIcon> = {
  'user': UserCheck,
  'shield': Shield,
  'graduation-cap': GraduationCap,
  'heart': Heart,
  'cake': Cake,
  'alert-triangle': AlertTriangle,
};

const colorMap: Record<string, string> = {
  'blue': 'bg-primary hover:bg-primary/90',
  'green': 'bg-primary hover:bg-primary/90',
  'purple': 'bg-primary hover:bg-primary/90',
  'red': 'bg-destructive hover:bg-destructive/90',
  'pink': 'bg-primary hover:bg-primary/90',
  'orange': 'bg-accent hover:bg-accent/90',
  'gray': 'bg-muted hover:bg-muted/90',
};

type TerminalPhase =
  | 'idle'
  | 'charging'
  | 'waiting'
  | 'approved'
  | 'declined'
  | 'error'
  | 'cancelled';

interface TerminalState {
  phase: TerminalPhase;
  chargeId?: string;
  authCode?: string;
  errorMessage?: string;
}

export default function POS() {
  const {
    data: products = [],
    isPending: productsPending,
    isError: productsFailed,
    error: productsError,
    refetch: refetchProducts,
  } = useProducts();
  const createOrder = useCreateOrder();
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
  const barcodeRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const navigate = useNavigate();
  
  // Discount state
  const [quickDiscounts, setQuickDiscounts] = useState<PosDiscountType[]>([]);
  const [appliedDiscounts, setAppliedDiscounts] = useState<AppliedDiscount[]>([]);
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [manualDiscountType, setManualDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [manualDiscountValue, setManualDiscountValue] = useState("");
  const [manualDiscountReason, setManualDiscountReason] = useState("");
  
  // Return dialog state
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);

  // Cash drawer state
  const [drawerDialogOpen, setDrawerDialogOpen] = useState(false);
  
  // Store branding and tax come from settings; the register keeps working on its
  // defaults if that call fails, rather than blocking a sale.
  const { data: settings } = useSettings();
  const storeName = settings?.storeName || "Steward · Register";
  const storeLogo = settings?.logoUrl || null;
  const taxRate = settings?.taxRateDefault ?? 0;

  const paymentMethods: PaymentMethodsConfig = useMemo(() => {
    const configured = settings?.config?.paymentMethods;

    return {
      cash: { enabled: true, ...configured?.cash },
      zelle: { enabled: false, ...configured?.zelle },
      card: { enabled: false, provider: 'square', ...configured?.card },
    };
  }, [settings]);

  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('Cash');
  const [cashTendered, setCashTendered] = useState('');

  // Terminal payment state
  const [terminalState, setTerminalState] = useState<TerminalState>({ phase: 'idle' });
  const terminalPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const terminalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lastOrderAuthCode, setLastOrderAuthCode] = useState<string | undefined>(undefined);

  useEffect(() => {
    loadQuickDiscounts();
  }, []);

  /**
   * Keep the selected payment method on something the store actually accepts.
   *
   * Settings arrive after first paint, so the initial 'Cash' default can turn out
   * to be disabled; this falls through to the first enabled method instead of
   * leaving the cashier on an option that cannot complete.
   */
  useEffect(() => {
    const enabled: Array<[string, boolean | undefined]> = [
      ['Cash', paymentMethods.cash?.enabled !== false],
      ['Zelle', paymentMethods.zelle?.enabled],
      ['Card', paymentMethods.card?.enabled],
    ];

    const stillOffered = enabled.some(([label, on]) => label === selectedPaymentMethod && on);
    if (stillOffered) return;

    const fallback = enabled.find(([, on]) => on)?.[0];
    if (fallback) setSelectedPaymentMethod(fallback);
  }, [paymentMethods, selectedPaymentMethod]);

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

  // Cleanup terminal polling on unmount
  useEffect(() => {
    return () => {
      stopTerminalPolling();
    };
  }, []);

  /** Category filter chips, derived from whatever the catalog actually contains. */
  const categories = useMemo(
    () => ["All", ...new Set(products.map(p => p.category).filter(Boolean))],
    [products]
  );

  const loadQuickDiscounts = async () => {
    try {
      const available = await discountsApi.types.listForPos();
      setQuickDiscounts(
        available.filter(
          (discount): discount is PosDiscountType =>
            discount.discountType === 'percentage' || discount.discountType === 'fixed'
        )
      );
    } catch (error) {
      // Non-critical: the register still sells without quick-discount chips.
      logger.warn('Failed to load quick discounts', error);
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

  /**
   * The money on the current cart.
   *
   * Single definition so cash checkout, card authorisation, and the order posted
   * after a card approval cannot drift apart - they previously each recomputed
   * this, and each hard-coded a 0% tax rate regardless of store settings.
   *
   * Phase 3 moves this arithmetic server-side; until then the client's figures
   * are what the backend records.
   */
  /**
   * The receipt's line items, taken from the created order.
   *
   * Not the local cart: the totals on the receipt come from the server now, and
   * pairing those with client-side line prices would print a receipt whose lines
   * do not add up to its own total whenever the server repriced something.
   * Falls back to the cart only if the response carries no items.
   */
  const receiptLinesFrom = (order: Order): CartItem[] =>
    (order.items ?? []).length > 0
      ? order.items!.map(item => ({
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          price: item.unitPrice,
          nameSnapshot: item.nameSnapshot,
          size: item.size,
          color: item.color,
          notes: item.notes,
          lineDiscount: item.lineDiscount,
        }))
      : [...cart];

  /** Strip an applied discount down to what the server needs to re-resolve it. */
  const toDiscountRequests = (applied: AppliedDiscount[]) =>
    applied.map((discount) => ({
      source: discount.source,
      id: discount.id,
      code: discount.code,
      type: discount.type,
      value: discount.value,
      reason: discount.source === 'manual' ? discount.name : undefined,
    }));

  const calculateTotals = () => {
    const subtotal = calculateSubtotal();
    const discountTotal = getTotalDiscount();
    const taxTotal = (subtotal - discountTotal) * taxRate;

    return { subtotal, discountTotal, taxTotal, total: subtotal - discountTotal + taxTotal };
  };

  /**
   * Change owed, or `null` when the tender does not cover the sale.
   *
   * A preview only - the server recomputes it against its own total and refuses
   * a shortfall, because the figure a cashier counts into someone's hand has to
   * match what was actually charged.
   */
  const changeDue = useMemo(() => {
    if (cashTendered === '') return null;
    const tendered = parseFloat(cashTendered);
    if (Number.isNaN(tendered)) return null;

    const owed = Math.round(calculateTotals().total * 100);
    const given = Math.round(tendered * 100);
    return given < owed ? null : (given - owed) / 100;
    // `calculateTotals` is redefined every render, so depending on it would
    // defeat the memo entirely. Its inputs are listed instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashTendered, cart, appliedDiscounts, taxRate]);

  /**
   * Note denominations a customer is likely to hand over.
   *
   * Rounded up from the total, so a $17.42 sale offers $20 rather than a list of
   * amounts that cannot cover it.
   */
  const quickCashOptions = useMemo(() => {
    const total = calculateTotals().total;
    const notes = [5, 10, 20, 50, 100];
    const above = notes.filter(note => note >= total);

    return [Math.ceil(total), ...above].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, appliedDiscounts, taxRate]);

  const applyQuickDiscount = (discount: PosDiscountType) => {
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
      const { promo } = await discountsApi.promos.validate({
        code: promoCodeInput.trim().toUpperCase(),
        cartTotal: subtotal,
        itemCount: cart.reduce((sum, item) => sum + item.quantity, 0),
      });

      // A rejected code comes back as success:false, which the client raises; the
      // catch below surfaces the server's reason.

      // Check if already applied
      if (appliedDiscounts.some(d => d.source === 'promo_code' && d.id === promo.id)) {
        toast({ title: 'Promo code already applied', variant: 'destructive' });
        return;
      }

      // Only these two kinds carry a cart-level amount the register can subtract.
      // `free_shipping`, `buy_x_get_y`, and `free_item` need line-level handling
      // this screen does not have, and the server returns 0 for them - applying
      // one anyway would take nothing off while telling the cashier it worked.
      if (promo.discountType !== 'percentage' && promo.discountType !== 'fixed') {
        toast({
          title: 'Promo code not supported at the register',
          description: `${promo.name} is a ${promo.discountType.replace(/_/g, ' ')} offer, which has to be applied another way.`,
          variant: 'destructive',
        });
        return;
      }

      setAppliedDiscounts([...appliedDiscounts, {
        source: 'promo_code',
        id: promo.id,
        code: promo.code,
        name: promo.name,
        type: promo.discountType,
        value: promo.discountValue,
        amount: promo.discountAmount,
      }]);

      setPromoCodeInput("");
      toast({
        title: 'Promo code applied!',
        description: `${promo.name} - $${promo.discountAmount.toFixed(2)} off`
      });
    } catch (error: unknown) {
      toast({ title: 'Promo code not applied', description: getErrorMessage(error, 'Invalid promo code'), variant: 'destructive' });
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

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return products.filter(product => {
      if (selectedCategory !== "All" && product.category !== selectedCategory) return false;
      if (!query) return true;

      return (
        product.name.toLowerCase().includes(query) ||
        Boolean(product.barcode?.includes(query))
      );
    });
  }, [products, searchQuery, selectedCategory]);

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
      const { subtotal, discountTotal, taxTotal, total } = calculateTotals();

      const orderData: CreateOrderRequest = {
        items: cart.map(item => {
          const orderItem: CreateOrderRequest['items'][number] = {
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
        // The server recomputes the amounts; this says which discounts to honour.
        appliedDiscounts: toDiscountRequests(appliedDiscounts),
        paymentMethod: selectedPaymentMethod,
        ...(selectedPaymentMethod === 'Cash' && cashTendered !== ''
          ? { cashTendered: parseFloat(cashTendered) }
          : {}),
        // Customer information is optional - only include if provided and not empty
        ...(customerEmail && customerEmail.trim() ? { customerEmail: customerEmail.trim() } : {}),
      };

      const response = await createOrder.mutateAsync(orderData);
      
      // Discount usage and promo redemption are recorded by the server as part
      // of creating the order, from the amounts it validated.

      toast({
        title: "Sale completed!",
        description: `Order ${response.id} saved successfully`,
      });

      // Show what the server actually recorded, not what this screen computed.
      // The two can differ - a price edited since the catalog was cached, or a
      // discount the server declined - and a receipt has to match the sale.
      setLastOrderId(response.id);
      setLastOrderTotal(response.total);
      setLastOrderSubtotal(response.subtotal);
      setLastOrderTax(response.taxTotal);
      setLastOrderDiscount(response.discountTotal);
      setLastOrderPaymentMethod(selectedPaymentMethod);
      setLastOrderItems(receiptLinesFrom(response));
      setLastOrderAuthCode(undefined);
      setCart([]);
      setCashTendered('');
      setCustomerEmail("");
      setAppliedDiscounts([]);
      // Reset to first enabled payment method for next sale
      if (paymentMethods.cash?.enabled !== false) setSelectedPaymentMethod('Cash');
      else if (paymentMethods.zelle?.enabled) setSelectedPaymentMethod('Zelle');
      else if (paymentMethods.card?.enabled) setSelectedPaymentMethod('Card');
      setCheckoutOpen(false);
      setReceiptDialogOpen(true);
      
      // Stock moved server-side; the order mutation invalidates the catalog cache.
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: getErrorMessage(error, 'Failed to create order'),
        variant: 'destructive',
      });
    }
  };

  // ── Terminal payment helpers ──────────────────────────────────────────────

  const stopTerminalPolling = () => {
    if (terminalPollRef.current) {
      clearInterval(terminalPollRef.current);
      terminalPollRef.current = null;
    }
    if (terminalTimeoutRef.current) {
      clearTimeout(terminalTimeoutRef.current);
      terminalTimeoutRef.current = null;
    }
  };

  const handleChargeCard = async () => {
    setTerminalState({ phase: 'charging' });

    try {
      // Ask the server what this cart costs before authorising anything. The
      // register's own arithmetic is a preview; the server reprices, and if the
      // two disagree - a price edited since the catalog was cached, a discount
      // that has since expired - charging the client's figure would take one
      // amount off the card and record another against the order.
      //
      // A rejected discount surfaces here as a thrown error, while the customer's
      // card is still in their hand.
      const quote = await ordersApi.quote({
        items: cart.map(item => ({
          productId: item.productId,
          variantId: item.variantId || undefined,
          quantity: item.quantity,
          notes: item.notes,
        })),
        appliedDiscounts: toDiscountRequests(appliedDiscounts),
      });

      // Card processors bill in minor units, so this is the one figure sent in cents.
      const amountCents = Math.round(quote.total * 100);

      const { chargeId } = await terminalApi.charge({
        amount: amountCents,
        currency: 'USD',
        description: 'POS Checkout',
      });

      setTerminalState({ phase: 'waiting', chargeId });

      terminalTimeoutRef.current = setTimeout(async () => {
        stopTerminalPolling();
        await terminalApi.cancel(chargeId);
        setTerminalState({ phase: 'error', errorMessage: 'No response from terminal — charge cancelled' });
      }, 90_000);

      terminalPollRef.current = setInterval(async () => {
        try {
          const { status, authCode, errorMessage } = await terminalApi.status(chargeId);

          if (status === 'approved') {
            stopTerminalPolling();
            setTerminalState({ phase: 'approved', chargeId, authCode });
            await completeCardOrder(chargeId, authCode);
          } else if (status === 'declined') {
            stopTerminalPolling();
            setTerminalState({ phase: 'declined', errorMessage: errorMessage || 'Card declined' });
          } else if (status === 'cancelled') {
            stopTerminalPolling();
            setTerminalState({ phase: 'cancelled' });
          } else if (status === 'error') {
            stopTerminalPolling();
            setTerminalState({ phase: 'error', errorMessage: errorMessage || 'Terminal error' });
          }
        } catch {
          // Network hiccup — keep polling
        }
      }, 2_000);
    } catch (error: unknown) {
      // Covers both the pricing call and the terminal. The server's message is
      // the useful one - "Only 2 left in stock" or "that discount has expired" -
      // so it wins over the generic fallback, which now only applies when there
      // is no message at all.
      setTerminalState({
        phase: 'error',
        errorMessage: getErrorMessage(error, 'Could not start the card payment'),
      });
    }
  };

  const handleCancelTerminal = async () => {
    const { chargeId } = terminalState;
    stopTerminalPolling();
    if (chargeId) {
      await terminalApi.cancel(chargeId).catch(() => {});
    }
    setTerminalState({ phase: 'idle' });
  };

  const completeCardOrder = async (chargeId: string, authCode?: string) => {
    try {
      const { subtotal, discountTotal, taxTotal, total } = calculateTotals();

      const orderData: CreateOrderRequest & { cardTransactionId?: string; cardAuthCode?: string } = {
        items: cart.map(item => {
          const orderItem: CreateOrderRequest['items'][number] = {
            productId: item.productId,
            nameSnapshot: item.nameSnapshot || '',
            quantity: item.quantity,
            unitPrice: item.price,
            lineDiscount: item.lineDiscount || 0,
            lineTotal: item.price * item.quantity - (item.lineDiscount || 0) * item.quantity,
          };

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
        appliedDiscounts: toDiscountRequests(appliedDiscounts),
        paymentMethod: 'Card',
        ...(customerEmail && customerEmail.trim() ? { customerEmail: customerEmail.trim() } : {}),
        cardTransactionId: chargeId,
        cardAuthCode: authCode,
      };

      const response = await createOrder.mutateAsync(orderData);

      // Discount usage and promo redemption are recorded by the server as part
      // of creating the order, from the amounts it validated.

      toast({
        title: 'Sale completed!',
        description: `Order ${response.id} saved successfully`,
      });

      // Show what the server actually recorded, not what this screen computed.
      // The two can differ - a price edited since the catalog was cached, or a
      // discount the server declined - and a receipt has to match the sale.
      setLastOrderId(response.id);
      setLastOrderTotal(response.total);
      setLastOrderSubtotal(response.subtotal);
      setLastOrderTax(response.taxTotal);
      setLastOrderDiscount(response.discountTotal);
      setLastOrderPaymentMethod('Card');
      setLastOrderItems(receiptLinesFrom(response));
      setLastOrderAuthCode(authCode);
      setCart([]);
      setCashTendered('');
      setCustomerEmail('');
      setAppliedDiscounts([]);
      if (paymentMethods.cash?.enabled !== false) setSelectedPaymentMethod('Cash');
      else if (paymentMethods.zelle?.enabled) setSelectedPaymentMethod('Zelle');
      else if (paymentMethods.card?.enabled) setSelectedPaymentMethod('Card');
      setTerminalState({ phase: 'idle' });
      setCheckoutOpen(false);
      setReceiptDialogOpen(true);
    } catch (error: unknown) {
      toast({
        title: 'Order save failed',
        description: error instanceof Error ? getErrorMessage(error) : 'Unknown error',
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
            ) : null}
            <div>
              <h1 className="text-xl font-bold text-foreground">{storeName}</h1>
              <p className="text-xs text-muted-foreground">{new Date().toLocaleTimeString()}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setDrawerDialogOpen(true)}
              className="border-border"
              size="sm"
            >
              <Wallet className="w-4 h-4 mr-1" />
              Drawer
            </Button>
            <Button
              variant="outline"
              onClick={() => setReturnDialogOpen(true)}
              className="border-destructive text-destructive hover:bg-destructive/10"
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
            {productsPending ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Loader2 className="w-10 h-10 text-muted-foreground/50 mb-4 animate-spin" />
                <p className="text-muted-foreground">Loading catalog…</p>
              </div>
            ) : productsFailed ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <AlertTriangle className="w-12 h-12 text-destructive/70 mb-4" />
                <p className="font-medium text-foreground">Catalog unavailable</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  {getErrorMessage(productsError, 'Could not reach the product service.')}
                </p>
                <Button variant="outline" className="mt-4" onClick={() => refetchProducts()}>
                  Try again
                </Button>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Package className="w-16 h-16 text-muted-foreground/30 mb-4" />
                <p className="text-muted-foreground">
                  {products.length === 0 ? 'No products in the catalog yet' : 'No products found'}
                </p>
                {products.length > 0 && (
                  <p className="text-sm text-muted-foreground/70 mt-1">
                    Try a different search or category
                  </p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {filteredProducts.map(product => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    onClick={() => handleProductClick(product)}
                  />
                ))}
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
        authCode={lastOrderAuthCode}
        items={lastOrderItems.map(item => ({
          id: item.productId,
          name: item.nameSnapshot ?? '',
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

          {/* Payment Method Selector */}
          <div className="border-t pt-4">
            <Label className="text-sm font-medium mb-3 block">Payment Method</Label>
            <div className="grid grid-cols-3 gap-2">
              {paymentMethods.cash?.enabled && (
                <Button
                  data-testid="pay-cash"
                  variant={selectedPaymentMethod === 'Cash' ? 'default' : 'outline'}
                  className="flex flex-col h-auto py-3 gap-1"
                  onClick={() => setSelectedPaymentMethod('Cash')}
                >
                  <Banknote className="w-5 h-5" />
                  <span className="text-xs font-medium">Cash</span>
                </Button>
              )}
              {paymentMethods.zelle?.enabled && (
                <Button
                  data-testid="pay-zelle"
                  variant={selectedPaymentMethod === 'Zelle' ? 'default' : 'outline'}
                  className="flex flex-col h-auto py-3 gap-1"
                  onClick={() => setSelectedPaymentMethod('Zelle')}
                >
                  <Smartphone className="w-5 h-5" />
                  <span className="text-xs font-medium">Zelle</span>
                  {paymentMethods.zelle.destination && (
                    <span className="text-xs opacity-70 truncate max-w-full px-1">{paymentMethods.zelle.destination}</span>
                  )}
                </Button>
              )}
              {paymentMethods.card?.enabled && (
                <Button
                  data-testid="pay-card"
                  variant={selectedPaymentMethod === 'Card' ? 'default' : 'outline'}
                  className="flex flex-col h-auto py-3 gap-1"
                  onClick={() => setSelectedPaymentMethod('Card')}
                >
                  <CreditCard className="w-5 h-5" />
                  <span className="text-xs font-medium">
                    {paymentMethods.card.provider
                      ? CARD_PROVIDER_LABELS[paymentMethods.card.provider] ?? 'Card'
                      : 'Card'}
                  </span>
                </Button>
              )}
            </div>
          </div>

          {/* Cash tendered */}
          {selectedPaymentMethod === 'Cash' && (
            <div className="border-t pt-4">
              <Label htmlFor="cashTendered" className="text-sm font-medium mb-3 block">
                Cash Received
              </Label>

              <div className="grid grid-cols-4 gap-2 mb-3">
                {quickCashOptions.map(amount => (
                  <Button
                    key={amount}
                    variant="outline"
                    size="sm"
                    onClick={() => setCashTendered(amount.toFixed(2))}
                  >
                    ${amount}
                  </Button>
                ))}
              </div>

              <Input
                id="cashTendered"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="Amount received"
                value={cashTendered}
                onChange={(e) => setCashTendered(e.target.value)}
              />

              {cashTendered !== '' && (
                <div
                  className={`mt-3 flex items-center justify-between rounded-md px-3 py-2 ${
                    changeDue === null
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-accent/10 text-foreground'
                  }`}
                >
                  {changeDue === null ? (
                    <span className="text-sm font-medium">
                      ${(calculateTotals().total - (parseFloat(cashTendered) || 0)).toFixed(2)} short
                    </span>
                  ) : (
                    <>
                      <span className="text-sm font-medium">Change due</span>
                      <span className="text-lg font-bold tabular-nums">${changeDue.toFixed(2)}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

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

          {/* Terminal Status Panel */}
          {terminalState.phase !== 'idle' && (
            <div className="border rounded-lg p-4 space-y-3 mt-4">
              {terminalState.phase === 'charging' && (
                <div className="flex items-center gap-3">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
                  <span className="text-sm">Connecting to terminal...</span>
                </div>
              )}

              {terminalState.phase === 'waiting' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
                    <span className="font-medium">Waiting for card...</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Present card on the terminal · ${(calculateSubtotal() - getTotalDiscount()).toFixed(2)}
                  </p>
                  <Button variant="outline" size="sm" onClick={handleCancelTerminal}>
                    Cancel
                  </Button>
                </div>
              )}

              {terminalState.phase === 'approved' && (
                <div className="flex items-center gap-2 text-green-600">
                  <span className="text-lg">✓</span>
                  <div>
                    <p className="font-medium">Card Approved</p>
                    {terminalState.authCode && (
                      <p className="text-xs text-muted-foreground">Auth: {terminalState.authCode}</p>
                    )}
                  </div>
                </div>
              )}

              {terminalState.phase === 'declined' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-destructive">
                    <span className="text-lg">✕</span>
                    <p className="font-medium">Card Declined</p>
                  </div>
                  {terminalState.errorMessage && (
                    <p className="text-sm text-muted-foreground">{terminalState.errorMessage}</p>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleChargeCard}>Try Again</Button>
                    <Button variant="outline" size="sm" onClick={() => setTerminalState({ phase: 'idle' })}>
                      Switch Method
                    </Button>
                  </div>
                </div>
              )}

              {(terminalState.phase === 'error' || terminalState.phase === 'cancelled') && (
                <div className="space-y-2">
                  <p className="text-sm text-destructive">
                    {terminalState.errorMessage || 'Terminal operation cancelled'}
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleChargeCard}>Retry</Button>
                    <Button variant="outline" size="sm" onClick={() => setTerminalState({ phase: 'idle' })}>
                      Switch Method
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckoutOpen(false)} className="border-border">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedPaymentMethod?.toLowerCase() === 'card' && paymentMethods.card?.enabled) {
                  handleChargeCard();
                } else {
                  handleCompleteCheckout();
                }
              }}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              disabled={terminalState.phase === 'charging' || terminalState.phase === 'waiting' || terminalState.phase === 'approved'}
            >
              Complete Sale - ${(calculateSubtotal() - getTotalDiscount()).toFixed(2)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Return Dialog */}
      <CashDrawerDialog open={drawerDialogOpen} onOpenChange={setDrawerDialogOpen} />

      <QuickReturnDialog
        open={returnDialogOpen}
        onClose={() => setReturnDialogOpen(false)}
        onComplete={() => refetchProducts()}
      />
    </div>
  );
}
