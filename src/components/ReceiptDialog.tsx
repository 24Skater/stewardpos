import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api-client";
import { Mail, Phone, Printer } from "lucide-react";

interface ReceiptSettings {
  storeName?: string;
  storePhone?: string;
  storeEmail?: string;
  storeAddress?: string;
  storeCity?: string;
  storeState?: string;
  storeZip?: string;
  storeNumber?: string;
  receiptLogoUrl?: string;
  receiptHeaderText?: string;
  receiptFooterText?: string;
  receiptShowLogo?: boolean;
  receiptShowBarcode?: boolean;
}

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  size?: string;
  color?: string;
}

interface ReceiptDialogProps {
  open: boolean;
  onClose: () => void;
  orderId: string;
  total: number;
  subtotal?: number;
  tax?: number;
  discount?: number;
  paymentMethod?: string;
  items?: CartItem[];
}

async function sendEmailMock(email: string, orderId: string): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      console.log(`Mock: Sending email receipt for ${orderId} to ${email}`);
      resolve();
    }, 500);
  });
}

async function sendSmsMock(phone: string, orderId: string): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      console.log(`Mock: Sending SMS receipt for ${orderId} to ${phone}`);
      resolve();
    }, 500);
  });
}

export default function ReceiptDialog({ 
  open, 
  onClose, 
  orderId, 
  total, 
  subtotal = 0,
  tax = 0,
  discount = 0,
  paymentMethod = 'cash',
  items = []
}: ReceiptDialogProps) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [settings, setSettings] = useState<ReceiptSettings>({});
  const { toast } = useToast();
  const receiptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      loadSettings();
    }
  }, [open]);

  const loadSettings = async () => {
    try {
      const res = await apiClient.get<{ success: boolean; data: ReceiptSettings }>('/api/admin/settings');
      if (res.success) {
        setSettings(res.data);
      }
    } catch (error) {
      // Use default empty settings
      console.error('Failed to load receipt settings:', error);
    }
  };

  const handleSendEmail = async () => {
    if (!email) {
      toast({ title: "Email required", variant: "destructive" });
      return;
    }
    setSending(true);
    await sendEmailMock(email, orderId);
    toast({ title: "Email sent!", description: `Receipt sent to ${email}` });
    setSending(false);
    onClose();
  };

  const handleSendSms = async () => {
    if (!phone) {
      toast({ title: "Phone required", variant: "destructive" });
      return;
    }
    setSending(true);
    await sendSmsMock(phone, orderId);
    toast({ title: "SMS sent!", description: `Receipt sent to ${phone}` });
    setSending(false);
    onClose();
  };

  const handlePrint = () => {
    const printContent = receiptRef.current;
    if (!printContent) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast({ title: "Unable to open print window", variant: "destructive" });
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Receipt - ${orderId}</title>
        <style>
          @page { 
            size: 80mm auto; 
            margin: 5mm;
          }
          body { 
            font-family: 'Courier New', monospace; 
            font-size: 12px; 
            max-width: 280px;
            margin: 0 auto;
            padding: 10px;
          }
          .header { text-align: center; margin-bottom: 15px; }
          .logo { max-height: 60px; max-width: 200px; margin-bottom: 10px; }
          .store-name { font-size: 16px; font-weight: bold; }
          .store-info { font-size: 11px; color: #666; }
          .header-text { font-style: italic; margin-top: 10px; font-size: 11px; }
          .separator { border-top: 1px dashed #000; margin: 10px 0; }
          .item { display: flex; justify-content: space-between; margin: 5px 0; }
          .item-details { font-size: 10px; color: #666; margin-left: 10px; }
          .totals { margin-top: 10px; }
          .total-line { display: flex; justify-content: space-between; }
          .grand-total { font-weight: bold; font-size: 14px; margin-top: 5px; }
          .footer { text-align: center; margin-top: 15px; font-size: 11px; }
          .barcode { text-align: center; margin: 15px 0; }
          .barcode-placeholder { 
            background: #000; 
            height: 40px; 
            width: 180px; 
            display: inline-block; 
          }
          .barcode-text { font-size: 10px; margin-top: 5px; }
          .footer-message { white-space: pre-line; color: #666; }
        </style>
      </head>
      <body>
        ${printContent.innerHTML}
      </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  };

  const formatAddress = () => {
    const parts = [];
    if (settings.storeAddress) parts.push(settings.storeAddress);
    
    const cityStateZip = [
      settings.storeCity,
      settings.storeState,
      settings.storeZip
    ].filter(Boolean).join(settings.storeCity && settings.storeState ? ', ' : ' ');
    
    if (cityStateZip) parts.push(cityStateZip);
    return parts;
  };

  const currentDate = new Date().toLocaleString();

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">Receipt</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Order {orderId.slice(0, 8).toUpperCase()} • Total: ${total.toFixed(2)}
          </DialogDescription>
        </DialogHeader>

        {/* Receipt Preview */}
        <div className="bg-white text-black p-6 rounded-lg border font-mono text-sm" ref={receiptRef}>
          {/* Header with Logo */}
          <div className="header text-center mb-4">
            {settings.receiptShowLogo !== false && settings.receiptLogoUrl && (
              <img 
                src={settings.receiptLogoUrl} 
                alt="Store Logo" 
                className="logo max-h-16 mx-auto mb-2"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            <p className="store-name font-bold text-lg">{settings.storeName || 'Store Name'}</p>
            {settings.storeNumber && (
              <p className="store-info text-xs">Store #{settings.storeNumber}</p>
            )}
            {formatAddress().map((line, i) => (
              <p key={i} className="store-info text-xs">{line}</p>
            ))}
            {settings.storePhone && (
              <p className="store-info text-xs">Tel: {settings.storePhone}</p>
            )}
          </div>

          {/* Header Text */}
          {settings.receiptHeaderText && (
            <div className="header-text text-center text-xs italic mb-4">
              {settings.receiptHeaderText}
            </div>
          )}

          <Separator className="separator my-3 border-dashed" />

          {/* Items */}
          <div className="space-y-2">
            {items.length > 0 ? items.map((item, idx) => (
              <div key={idx}>
                <div className="item flex justify-between">
                  <span>{item.name}{item.quantity > 1 ? ` x${item.quantity}` : ''}</span>
                  <span>${(item.price * item.quantity).toFixed(2)}</span>
                </div>
                {(item.size || item.color) && (
                  <p className="item-details text-xs text-gray-500 ml-2">
                    {[item.size, item.color].filter(Boolean).join(' / ')}
                  </p>
                )}
              </div>
            )) : (
              <p className="text-gray-500 text-center">No items</p>
            )}
          </div>

          <Separator className="separator my-3 border-dashed" />

          {/* Totals */}
          <div className="totals space-y-1">
            <div className="total-line flex justify-between">
              <span>Subtotal</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            {discount > 0 && (
              <div className="total-line flex justify-between text-red-600">
                <span>Discount</span>
                <span>-${discount.toFixed(2)}</span>
              </div>
            )}
            <div className="total-line flex justify-between">
              <span>Tax</span>
              <span>${tax.toFixed(2)}</span>
            </div>
            <div className="grand-total flex justify-between font-bold text-base border-t border-dashed pt-2 mt-2">
              <span>TOTAL</span>
              <span>${total.toFixed(2)}</span>
            </div>
          </div>

          <Separator className="separator my-3 border-dashed" />

          {/* Transaction Info */}
          <div className="text-center text-xs space-y-1">
            <p>{currentDate}</p>
            <p>Order #{orderId.slice(0, 8).toUpperCase()}</p>
            <p>Payment: {paymentMethod.toUpperCase()}</p>
          </div>

          {/* Barcode */}
          {settings.receiptShowBarcode !== false && (
            <div className="barcode text-center mt-4">
              <div className="barcode-placeholder bg-black h-10 w-48 mx-auto"></div>
              <p className="barcode-text text-xs mt-1">*{orderId.slice(0, 8).toUpperCase()}*</p>
            </div>
          )}

          {/* Footer */}
          {settings.receiptFooterText && (
            <>
              <Separator className="separator my-3 border-dashed" />
              <div className="footer text-center text-xs whitespace-pre-line text-gray-600">
                {settings.receiptFooterText}
              </div>
            </>
          )}
        </div>

        {/* Send Options */}
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="receipt-email" className="text-foreground">Email Receipt</Label>
            <div className="flex gap-2">
              <Input
                id="receipt-email"
                type="email"
                placeholder="customer@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-background border-border flex-1"
              />
              <Button onClick={handleSendEmail} disabled={sending} className="bg-primary text-primary-foreground">
                <Mail className="w-4 h-4 mr-2" />
                Send
              </Button>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="receipt-phone" className="text-foreground">SMS Receipt</Label>
            <div className="flex gap-2">
              <Input
                id="receipt-phone"
                type="tel"
                placeholder="(555) 123-4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="bg-background border-border flex-1"
              />
              <Button onClick={handleSendSms} disabled={sending} className="bg-primary text-primary-foreground">
                <Phone className="w-4 h-4 mr-2" />
                Send
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="w-4 h-4 mr-2" />
            Print
          </Button>
          <Button variant="outline" onClick={onClose} className="border-border">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
