import { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ProductCard from "@/components/ProductCard";
import Cart from "@/components/Cart";
import VariantPicker from "@/components/VariantPicker";
import ReceiptDialog from "@/components/ReceiptDialog";
import { discountsApi, ordersApi, storeCreditsApi, terminalApi } from "@/lib/api";
import type {
  CartItem,
  CreateOrderRequest,
  DiscountType as ApiDiscountType,
  Order,
  PaymentMethodsConfig,
  PaymentRequest,
  Product,
  StoreCredit,
  ValidatedPromo,
} from "@/lib/api";
import { useCreateOrder, useCurrentShift, useEndShift, useProducts, useRegister, useSettings } from "@/hooks/queries";
import { useRegisterHeartbeat } from "@/hooks/useRegisterHeartbeat";
import { useIdleLock } from "@/hooks/useIdleLock";
import LockScreen from "@/components/register/LockScreen";
import ActingAsBanner from "@/components/register/ActingAsBanner";
import OverridePrompt, { type OverrideGrant } from "@/components/register/OverridePrompt";
import { getDeviceToken, getSelectedRegisterId, subscribeToSelectedRegisterId } from "@/lib/register-device";
import { ApiClientError } from "@/lib/api-client";
import { SHIFT_REQUIRED, OVERRIDE_REQUIRED } from "@/lib/register-error-codes";
import type { OverrideAction } from "@/lib/api";
import { logger } from "@/lib/logger";
import type { AppliedDiscount } from "@/lib/register-math";
import {
  amountDueAfterCredit,
  buildPayments as buildPaymentsFor,
  calculateDiscountAmount as discountAmountOf,
  calculateSubtotal as subtotalOf,
  calculateTotals as totalsOf,
  changeDueFor,
  creditAppliedTo,
  getTotalDiscount as totalDiscountOf,
  quickCashOptionsFor,
  receiptLinesFrom as receiptLinesOf,
  toDiscountRequests as discountRequestsOf,
} from "@/lib/register-math";
import { LayoutGrid, Package, Search, Barcode, Settings as SettingsIcon, ShieldCheck, Briefcase, Tag, X, Percent, DollarSign, Gift, CheckCircle2, UserCheck, Shield, GraduationCap, Heart, Cake, AlertTriangle, RotateCcw, Banknote, Smartphone, CreditCard, Loader2, Wallet, LogOut, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import QuickReturnDialog from "@/components/QuickReturnDialog";
import CashDrawerDialog from "@/components/CashDrawerDialog";
import RegisterSwitcher from "@/components/RegisterSwitcher";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNavigate } from "react-router-dom";
import { getErrorMessage } from '@/lib/errors';
import { authStore, readAssumedSession } from '@/lib/auth-store';
import { useSession } from '@/hooks/queries/useSession';
import { hasPermission } from '@/lib/auth';

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
  // Keeps an enrolled terminal's liveness current on the admin console while
  // this screen is open. No-op on a terminal that hasn't paired a device.
  useRegisterHeartbeat();

  // ── Cashier sign-on (shifts) ──────────────────────────────────────────────
  // Which register this terminal is set to, kept in sync with changes made
  // elsewhere (RegisterSwitcher) via the same subscription it uses.
  const [registerId, setRegisterId] = useState<string | null>(() => getSelectedRegisterId());
  useEffect(() => subscribeToSelectedRegisterId(setRegisterId), []);

  const { data: currentRegister } = useRegister(registerId ?? undefined);
  const requiresSignIn = Boolean(currentRegister?.requireSignIn);
  // `GET /shifts/current` authenticates as the DEVICE (X-Register-Token), not
  // this browser's user session — see `registers.ts`'s route comment — so it
  // is only meaningful once this terminal has paired one. An unpaired
  // terminal on a require-sign-in register cannot ask "who's on" at all;
  // rather than guess, this leaves the POS usable exactly as it was before
  // Phase 4, the same fallback `useRegisterHeartbeat` takes.
  const hasDeviceToken = Boolean(getDeviceToken());
  const shiftGateActive = requiresSignIn && hasDeviceToken && Boolean(registerId);
  const currentShiftQuery = useCurrentShift(registerId ?? undefined, shiftGateActive);
  const openShift = currentShiftQuery.data?.shift ?? null;
  const cashier = currentShiftQuery.data?.cashier ?? null;
  const endShift = useEndShift();

  // Forced shut, independent of what the last-fetched shift said — set the
  // instant this screen decides the till must lock (idle timeout, or a
  // checkout refused with SHIFT_REQUIRED) rather than waiting on a network
  // round trip to confirm it. Cleared the moment a new shift opens.
  const [forceLock, setForceLock] = useState(false);

  // Only consult this once the query has actually resolved once - while it is
  // still pending, `openShift` reads as null and would otherwise flash the
  // lock screen open over an already-signed-on till on every mount.
  const shiftKnown = !currentShiftQuery.isPending;
  const showLockScreen = shiftGateActive && shiftKnown && (forceLock || !openShift);

  /**
   * UI convenience only - see the doc comment on `useIdleLock`. The backend
   * is the real enforcement point (idle expiry is decided lazily, server-side,
   * the next time anything asks whether a shift is open); this just gets the
   * lock screen in front of a cashier promptly rather than leaving them to
   * find out at checkout. It does not touch `cart` - locking only covers the
   * screen, so a sale in progress is never lost.
   */
  useIdleLock(
    currentRegister?.idleLockSeconds,
    () => setForceLock(true),
    shiftGateActive && Boolean(openShift) && !forceLock
  );

  const handleSignOut = async () => {
    if (!registerId) return;
    try {
      await endShift.mutateAsync(registerId);
      toast({ title: 'Signed out' });
    } catch (error: unknown) {
      toast({ title: 'Could not sign out', description: getErrorMessage(error), variant: 'destructive' });
    }
  };

  /**
   * Set only by `POST /api/auth/till/assume`. A cashier's own PIN session
   * writes nothing here, so the banner never appears at a real till.
   */
  const assumed = readAssumedSession();

  /**
   * Leave an assumed session.
   *
   * Ends the shift the way an ordinary sign-out does, then drops the token.
   * That second half is the part that matters: the backend already refuses the
   * token once the shift closes, but a client holding on to it walks back past
   * `RequireTill` and meets a 401 at the first thing it touches, rather than
   * the lock screen it should be looking at.
   *
   * It goes nowhere afterwards, and that is deliberate. Sending the admin back
   * to `/admin/registers` — where they came from — stranded them at `/login`
   * instead: the token dropped above *is* their session, because assuming a
   * till replaces the back-office one, so `RequireAuth` had nothing left to
   * admit them with. The till is where they are standing, and ending the shift
   * puts POS's own lock screen up as soon as it refetches, exactly as an
   * ordinary sign-out does. An admin who wants the back office signs in there.
   */
  const handleEndAssumedSession = async () => {
    await handleSignOut();
    // Also clears the assumed record, so the banner cannot outlive it.
    authStore.clearToken();
  };

  /** SHIFT_REQUIRED on checkout — see the two catch blocks below that call this. */
  const isShiftRequiredError = (error: unknown): boolean =>
    error instanceof ApiClientError && (error.body as { code?: string } | undefined)?.code === SHIFT_REQUIRED;

  /**
   * OVERRIDE_REQUIRED on checkout — a discount past its approval threshold.
   * Returns the refused action's name so the caller can build the right
   * description, `null` when the error is not this.
   */
  const overrideRequiredAction = (error: unknown): OverrideAction | null => {
    if (!(error instanceof ApiClientError)) return null;
    const body = error.body as { code?: string; data?: { action?: string } } | undefined;
    if (body?.code !== OVERRIDE_REQUIRED) return null;
    return (body.data?.action as OverrideAction | undefined) ?? null;
  };

  /**
   * What's being authorised, in plain language — see `OverridePrompt.tsx`'s
   * doc comment on why this can never read as a generic "Enter PIN".
   */
  const describeDiscountOverride = (discounts: AppliedDiscount[]): string => {
    if (discounts.length === 1) {
      const [discount] = discounts;
      return discount.type === 'percentage'
        ? `Approve a ${discount.value}% discount ("${discount.name}")`
        : `Approve a $${discount.amount.toFixed(2)} discount ("${discount.name}")`;
    }
    const total = discounts.reduce((sum, d) => sum + d.amount, 0);
    return `Approve ${discounts.length} discounts totalling $${total.toFixed(2)}`;
  };

  // A privileged action a cashier hit was refused with OVERRIDE_REQUIRED —
  // `run` retries that exact action once a supervisor's grant lands.
  // `grantExpired` distinguishes "ask for the first time" from "that grant
  // didn't survive the round trip, ask again" — see `OverridePrompt.tsx`.
  const [pendingOverride, setPendingOverride] = useState<{
    action: OverrideAction;
    description: string;
    run: (token: string) => void;
    grantExpired: boolean;
  } | null>(null);

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
  const { data: session } = useSession();

  /**
   * Whether to offer the Admin button at all.
   *
   * `/admin` needs `reports:read` — the same permission `App.tsx` gates the
   * route on. This used to be unconditional, which was harmless while every
   * till sat behind a back-office login; with a cashier's PIN session behind it
   * the button leads only to a 403, and a button that only ever fails is worse
   * than no button. Absent while the session is still unknown, so it does not
   * flicker in and then vanish under the cursor.
   */
  const canReachAdmin = session ? hasPermission(session, 'reports', 'read') : false;
  
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

  // A store credit applied to this sale. It is a *tender*, not a discount: it
  // reduces what is owed, not what the sale was worth, so it never touches the
  // totals - only how they are paid.
  const [appliedCredit, setAppliedCredit] = useState<StoreCredit | null>(null);
  const [creditCodeInput, setCreditCodeInput] = useState('');
  const [creditLoading, setCreditLoading] = useState(false);

  // Terminal payment state
  const [terminalState, setTerminalState] = useState<TerminalState>({ phase: 'idle' });
  const terminalPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const terminalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The server's id for the payment now in flight.
   *
   * Handed back when the order is created so the money taken and the sale
   * recorded are one fact. Held in a ref rather than state because the polling
   * callback reads it, and it must not depend on a re-render having happened.
   */
  const chargeAttemptRef = useRef<string | null>(null);
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

  const calculateSubtotal = () => subtotalOf(cart);

  const calculateDiscountAmount = (discount: AppliedDiscount, subtotal: number) =>
    discountAmountOf(discount, subtotal);

  const getTotalDiscount = () => totalDiscountOf(cart, appliedDiscounts);

  // The arithmetic below lives in `@/lib/register-math`, where it can be tested
  // without rendering this screen. These are the bindings the rest of the file
  // reads; the reasoning for each rule is documented alongside the functions.

  const receiptLinesFrom = (order: Order): CartItem[] => receiptLinesOf(order, cart);

  const toDiscountRequests = (applied: AppliedDiscount[]) => discountRequestsOf(applied);

  const calculateTotals = () => totalsOf(cart, appliedDiscounts, taxRate);

  const creditApplied = useMemo(
    () => creditAppliedTo(totalsOf(cart, appliedDiscounts, taxRate).total, appliedCredit),
    [appliedCredit, cart, appliedDiscounts, taxRate]
  );

  const amountDue = useMemo(
    () =>
      amountDueAfterCredit(totalsOf(cart, appliedDiscounts, taxRate).total, creditApplied),
    [creditApplied, cart, appliedDiscounts, taxRate]
  );

  const buildPayments = (method: string): PaymentRequest[] | undefined =>
    buildPaymentsFor(method, appliedCredit, creditApplied, amountDue);

  const changeDue = useMemo(
    () => changeDueFor(cashTendered, amountDue),
    [cashTendered, amountDue]
  );

  const quickCashOptions = useMemo(() => quickCashOptionsFor(amountDue), [amountDue]);

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

  const applyStoreCredit = async () => {
    if (!creditCodeInput.trim()) return;

    setCreditLoading(true);
    try {
      const credit = await storeCreditsApi.get(creditCodeInput.trim());

      if (credit.status !== 'active' || credit.remainingAmount <= 0) {
        toast({
          title: 'That credit cannot be used',
          description: `It is ${credit.status} with $${credit.remainingAmount.toFixed(2)} left.`,
          variant: 'destructive',
        });
        return;
      }

      setAppliedCredit(credit);
      setCreditCodeInput('');
      toast({
        title: 'Store credit applied',
        description: `$${credit.remainingAmount.toFixed(2)} available.`,
      });
    } catch (error: unknown) {
      toast({
        title: 'Store credit not applied',
        description: getErrorMessage(error, 'No credit with that code'),
        variant: 'destructive',
      });
    } finally {
      setCreditLoading(false);
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

  const handleCompleteCheckout = async (overrideToken?: string) => {
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
        ...(buildPayments(selectedPaymentMethod) ? { payments: buildPayments(selectedPaymentMethod) } : {}),
        ...(selectedPaymentMethod === 'Cash' && cashTendered !== ''
          ? { cashTendered: parseFloat(cashTendered) }
          : {}),
        // Customer information is optional - only include if provided and not empty
        ...(customerEmail && customerEmail.trim() ? { customerEmail: customerEmail.trim() } : {}),
      };

      const response = await createOrder.mutateAsync({ body: orderData, overrideToken });
      
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
      setAppliedCredit(null);
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
      if (isShiftRequiredError(error)) {
        // A cashier who has been away too long, discovered at the worst
        // possible moment - checkout. The cart is untouched: the checkout
        // dialog just closes and the lock screen takes over on top of it, the
        // same overlay the idle timer shows, so signing back in returns
        // straight to this same cart rather than losing the sale.
        setCheckoutOpen(false);
        setForceLock(true);
        toast({
          title: 'Sign-in required',
          description: 'This register requires a cashier to sign in before completing a sale.',
          variant: 'destructive',
        });
        return;
      }
      const refused = overrideRequiredAction(error);
      if (refused === 'discount_approval') {
        // The cart is deliberately left exactly as it is. A cashier who has
        // scanned twenty items and needs a discount approved must not lose
        // them - `run` closes over this same cart and retries the identical
        // order once a supervisor's grant lands.
        setPendingOverride({
          action: 'discount_approval',
          description: describeDiscountOverride(appliedDiscounts),
          run: (token: string) => void handleCompleteCheckout(token),
          grantExpired: false,
        });
        return;
      }

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
      // The credit covering the whole sale is the one case with nothing to put
      // on a card, and the register can tell locally. Everything else goes to
      // the server, which prices the cart and decides the amount itself — the
      // till no longer computes a figure and asks for it to be charged.
      if (appliedCredit && amountDue <= 0) {
        setTerminalState({ phase: 'idle' });
        await completeCardOrder('', undefined);
        return;
      }

      // Send what is being sold, not what we think it costs. A price edited
      // since the catalog was cached or a discount that has since expired now
      // changes the charge rather than desynchronising it from the order, and a
      // rejected discount surfaces here while the card is still in hand.
      const { chargeId, attemptId } = await terminalApi.charge({
        items: cart.map(item => ({
          productId: item.productId,
          variantId: item.variantId || undefined,
          quantity: item.quantity,
          notes: item.notes,
        })),
        appliedDiscounts: toDiscountRequests(appliedDiscounts) as unknown as Array<Record<string, unknown>>,
        storeCreditCode: appliedCredit?.code,
        currency: 'USD',
        description: 'POS Checkout',
      });

      chargeAttemptRef.current = attemptId ?? null;
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

  const completeCardOrder = async (chargeId: string, authCode?: string, overrideToken?: string) => {
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
        ...(buildPayments('Card') ? { payments: buildPayments('Card') } : {}),
        ...(customerEmail && customerEmail.trim() ? { customerEmail: customerEmail.trim() } : {}),
        cardTransactionId: chargeId,
        ...(chargeAttemptRef.current ? { attemptId: chargeAttemptRef.current } : {}),
        cardAuthCode: authCode,
      };

      const response = await createOrder.mutateAsync({ body: orderData, overrideToken });

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
      setAppliedCredit(null);
      setCustomerEmail('');
      setAppliedDiscounts([]);
      if (paymentMethods.cash?.enabled !== false) setSelectedPaymentMethod('Cash');
      else if (paymentMethods.zelle?.enabled) setSelectedPaymentMethod('Zelle');
      else if (paymentMethods.card?.enabled) setSelectedPaymentMethod('Card');
      setTerminalState({ phase: 'idle' });
      setCheckoutOpen(false);
      setReceiptDialogOpen(true);
    } catch (error: unknown) {
      if (isShiftRequiredError(error)) {
        // Same recovery as the cash path: lock, keep the cart, let the
        // cashier sign back in. Note the card has already been authorised by
        // this point (`completeCardOrder` only runs after `approved`) - a
        // shift that lapses in the gap between charging and saving the order
        // is a pre-existing risk this phase does not add, since the same
        // exposure exists for any order-save failure after a card capture.
        setCheckoutOpen(false);
        setForceLock(true);
        toast({
          title: 'Sign-in required',
          description: 'This register requires a cashier to sign in before completing a sale.',
          variant: 'destructive',
        });
        return;
      }
      const refused = overrideRequiredAction(error);
      if (refused === 'discount_approval') {
        // The card is already authorised at this point, so the sale must be
        // recoverable rather than abandoned: the retry re-saves the identical
        // order with the same charge id, it does not charge again.
        setPendingOverride({
          action: 'discount_approval',
          description: describeDiscountOverride(appliedDiscounts),
          run: (token: string) => void completeCardOrder(chargeId, authCode, token),
          grantExpired: false,
        });
        return;
      }

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

      {/* Above the header, not inside it: an admin driving someone else's till
          should not have to look for this. */}
      {assumed && (
        <ActingAsBanner
          adminName={assumed.adminName}
          actingAs={assumed.actingAs}
          onExit={handleEndAssumedSession}
        />
      )}

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
          {/* Wraps rather than overflowing: this row has grown a control per
              phase (drawer, returns, and now the register switcher), and on a
              1024px tablet an unwrapped row pushed 60px off-screen — controls a
              cashier cannot reach, with no scrollbar to hint they exist. */}
          <div className="flex flex-wrap justify-end gap-2 min-w-0">
            {/* Who's on this till right now, and a way off it. Only shown once
                a shift is actually open - a register that does not require
                sign-in, or one this terminal hasn't paired, has nothing to
                show here. */}
            {shiftGateActive && openShift && cashier && (
              <div className="flex items-center gap-1 rounded-md border border-border bg-background px-2">
                <UserRound className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                <span className="text-sm font-medium truncate max-w-[10rem]" title={cashier.name}>
                  {cashier.name}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSignOut}
                  disabled={endShift.isPending}
                  aria-label={`Sign out ${cashier.name}`}
                >
                  <LogOut className="w-4 h-4" aria-hidden="true" />
                </Button>
              </div>
            )}
            <RegisterSwitcher />
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
              onClick={() => navigate('/settings')}
              className="border-border"
              size="sm"
            >
              <SettingsIcon className="w-4 h-4 mr-1" />
              Settings
            </Button>
            {/*
              `/admin`, not `/login`.

              This sent every cashier to the sign-in page instead of the admin
              dashboard — and because nothing had set `?next=`, signing in
              returned them to the register. The button appeared to do nothing
              except make you log in again.

              Routing to the destination is also what makes the guard work:
              `RequireAuth` sends an unauthenticated visitor to
              `/login?next=/admin` and Login brings them back afterwards.
            */}
            {canReachAdmin && (
              <Button
                variant="default"
                onClick={() => navigate('/admin')}
                className="bg-primary hover:bg-primary/90"
                size="sm"
              >
                <ShieldCheck className="w-4 h-4 mr-1" />
                Admin
              </Button>
            )}
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
              <Button variant="outline" size="icon" className="border-border" aria-label="Scan barcode">
                <Barcode className="w-4 h-4" aria-hidden="true" />
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
          {/*
            `tabIndex={0}` because a scrollable region that cannot take focus
            cannot be scrolled from the keyboard at all — axe flags this as a
            serious violation, and on a till it means the catalog below the fold
            is unreachable without a mouse.
          */}
          <div className="flex-1 overflow-y-auto p-4" tabIndex={0} role="region" aria-label="Products">
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
                  {/*
                    A pair of icon-only toggles announcing themselves as
                    "button". `aria-pressed` because they are a toggle, not two
                    separate actions — without it a screen reader gives no way
                    to tell which kind of discount is currently selected.
                  */}
                  <div className="flex-1 flex gap-2" role="group" aria-label="Discount type">
                    <Button
                      variant={manualDiscountType === 'percentage' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setManualDiscountType('percentage')}
                      aria-label="Percentage discount"
                      aria-pressed={manualDiscountType === 'percentage'}
                    >
                      <Percent className="w-4 h-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant={manualDiscountType === 'fixed' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setManualDiscountType('fixed')}
                      aria-label="Fixed-amount discount"
                      aria-pressed={manualDiscountType === 'fixed'}
                    >
                      <DollarSign className="w-4 h-4" aria-hidden="true" />
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

          {/* Store credit — a tender, applied before the rest is paid */}
          <div className="border-t pt-4">
            <Label htmlFor="storeCredit" className="text-sm font-medium mb-3 block">
              Store Credit
            </Label>

            {appliedCredit ? (
              <div className="flex items-center justify-between rounded-md bg-accent/10 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{appliedCredit.code}</p>
                  <p className="text-xs text-muted-foreground">
                    ${creditApplied.toFixed(2)} applied
                    {creditApplied < appliedCredit.remainingAmount &&
                      ` — $${(appliedCredit.remainingAmount - creditApplied).toFixed(2)} stays on the credit`}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setAppliedCredit(null)} aria-label="Remove the applied store credit">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  id="storeCredit"
                  placeholder="Credit code"
                  value={creditCodeInput}
                  onChange={(e) => setCreditCodeInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && applyStoreCredit()}
                />
                <Button
                  data-testid="apply-store-credit"
                  variant="outline"
                  onClick={applyStoreCredit}
                  disabled={creditLoading}
                >
                  {creditLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply'}
                </Button>
              </div>
            )}

            {appliedCredit && amountDue > 0 && (
              <p className="mt-2 text-sm">
                <span className="text-muted-foreground">Still due: </span>
                <span className="font-semibold tabular-nums">${amountDue.toFixed(2)}</span>
              </p>
            )}
            {appliedCredit && amountDue === 0 && (
              <p className="mt-2 text-sm font-medium text-accent-foreground">
                The credit covers this sale in full.
              </p>
            )}
          </div>

          {/* Cash tendered */}
          {selectedPaymentMethod === 'Cash' && amountDue > 0 && (
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
                        aria-label={`Remove the ${discount.name} discount`}
                      >
                        <X className="w-3 h-3" aria-hidden="true" />
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
              {calculateTotals().taxTotal > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tax</span>
                  <span>${calculateTotals().taxTotal.toFixed(2)}</span>
                </div>
              )}
              <div className="border-t pt-2 flex justify-between items-center">
                <span className="text-lg font-semibold text-foreground">Total</span>
                {/*
                  The figure the customer is charged, tax included.

                  This read `subtotal - discount`, which dropped tax entirely
                  while the order posted to the server carried it — so a store
                  with a tax rate showed the cashier one number and billed
                  another.
                */}
                <span className="text-2xl font-bold text-primary">
                  ${calculateTotals().total.toFixed(2)}
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
              {/* What the customer actually pays now: the priced total less any
                  store credit. The old label showed subtotal minus discount,
                  which ignored tax and, once credits arrived, the credit too. */}
              Complete Sale - ${amountDue.toFixed(2)}
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

      {/* Rendered as an overlay sibling, not a route change or an early
          return - the cart above lives in this component's own state and is
          never unmounted by locking, only hidden behind an opaque, non-
          dismissible screen. See LockScreen's doc comment for why it can't be
          clicked or Escaped away. */}
      {showLockScreen && currentRegister && registerId && (
        <LockScreen
          displayCode={currentRegister.displayCode}
          onUnlocked={() => setForceLock(false)}
        />
      )}

      {/* A supervisor authorising one action. Unlike the lock screen this is
          dismissible: cancelling an override means "we won't do that", which
          is a legitimate answer, and it must leave the cart exactly as it was. */}
      {pendingOverride && registerId && (
        <OverridePrompt
          open
          onOpenChange={(next) => {
            if (!next) setPendingOverride(null);
          }}
          registerId={registerId}
          action={pendingOverride.action}
          description={pendingOverride.description}
          grantExpired={pendingOverride.grantExpired}
          onGranted={(grant: OverrideGrant) => {
            const retry = pendingOverride.run;
            setPendingOverride(null);
            retry(grant.token);
          }}
        />
      )}
    </div>
  );
}
