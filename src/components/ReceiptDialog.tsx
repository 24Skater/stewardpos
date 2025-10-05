import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Mail, Phone } from "lucide-react";

interface ReceiptDialogProps {
  open: boolean;
  onClose: () => void;
  orderId: string;
  total: number;
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

export default function ReceiptDialog({ open, onClose, orderId, total }: ReceiptDialogProps) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const { toast } = useToast();

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

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">Send Receipt</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Order {orderId} • Total: ${total.toFixed(2)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="receipt-email" className="text-foreground">Email Address</Label>
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
            <Label htmlFor="receipt-phone" className="text-foreground">Phone Number</Label>
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

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-border">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
