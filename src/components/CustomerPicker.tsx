import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { customersApi } from "@/lib/api";
import type { Customer } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { formatPhone, phoneDigits, PHONE_DIGITS } from "@/lib/phone";
import PhoneInput from "@/components/PhoneInput";
import { UserPlus, UserRound, X, Loader2 } from "lucide-react";

const MAX_RESULTS = 8;

interface CustomerPickerProps {
  selected: Customer | null;
  onSelect: (customer: Customer | null) => void;
}

/** Attach a sale to an existing customer, or add a new one without leaving the till. */
export default function CustomerPicker({ selected, onSelect }: CustomerPickerProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", email: "", phone: "" });

  useEffect(() => {
    customersApi
      .list()
      .then(setCustomers)
      .catch((error: unknown) => setLoadError(getErrorMessage(error)));
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    // Phones are stored as bare digits, so "(202) 538" has to match "202538...".
    const digits = phoneDigits(q);
    return customers
      .filter((c) => [c.name, c.email].some((field) => field?.toLowerCase().includes(q)) || (!!digits && !!c.phone?.includes(digits)))
      .slice(0, MAX_RESULTS);
  }, [customers, query]);

  const startCreate = () => {
    // Seed the form from what was typed: an @ is an email, all digits a phone, otherwise a name.
    const typed = query.trim();
    if (typed.includes("@")) setDraft({ name: "", email: typed, phone: "" });
    else if (/^[\d\s().+-]+$/.test(typed)) setDraft({ name: "", email: "", phone: phoneDigits(typed) });
    else setDraft({ name: typed, email: "", phone: "" });
    setSaveError(null);
    setCreating(true);
  };

  const phoneIncomplete = draft.phone.length > 0 && draft.phone.length < PHONE_DIGITS;

  const saveCustomer = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const created = await customersApi.create({
        name: draft.name.trim(),
        ...(draft.email.trim() ? { email: draft.email.trim() } : {}),
        ...(draft.phone ? { phone: draft.phone } : {}),
      });
      setCustomers((prev) => [created, ...prev]);
      setCreating(false);
      setQuery("");
      onSelect(created);
    } catch (error: unknown) {
      setSaveError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  if (selected) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/40 p-3">
        <div className="min-w-0">
          <p className="font-medium text-foreground">{selected.name}</p>
          {selected.email && <p className="truncate text-sm text-muted-foreground">{selected.email}</p>}
          {selected.phone && <p className="text-sm text-muted-foreground">{formatPhone(selected.phone)}</p>}
        </div>
        <Button variant="ghost" size="sm" onClick={() => onSelect(null)} aria-label="Remove customer from sale">
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  if (creating) {
    return (
      <div className="space-y-3 rounded-md border border-border p-3">
        <div className="space-y-1">
          <Label htmlFor="new-customer-name">Name</Label>
          <Input
            id="new-customer-name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            autoFocus
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-customer-email">Email <span className="text-xs text-muted-foreground">(optional)</span></Label>
          <Input
            id="new-customer-email"
            type="email"
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-customer-phone">Phone <span className="text-xs text-muted-foreground">(optional)</span></Label>
          <PhoneInput
            id="new-customer-phone"
            value={draft.phone}
            onChange={(phone) => setDraft({ ...draft, phone })}
          />
          {phoneIncomplete && <p className="text-xs text-destructive">Enter all 10 digits, or leave it blank.</p>}
        </div>
        {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setCreating(false)} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={saveCustomer} disabled={saving || !draft.name.trim() || phoneIncomplete}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add customer
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="customer-search" className="text-foreground">
        Customer <span className="text-xs font-normal text-muted-foreground">(Optional)</span>
      </Label>
      <div className="flex gap-2">
        <Input
          id="customer-search"
          placeholder="Search name, email or phone"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="bg-background border-border"
        />
        <Button variant="outline" onClick={startCreate}>
          <UserPlus className="mr-2 h-4 w-4" />
          New
        </Button>
      </div>
      {loadError && <p role="alert" className="text-sm text-destructive">Couldn't load customers: {loadError}</p>}
      {matches.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => { setQuery(""); onSelect(c); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted focus:bg-muted focus:outline-none"
              >
                <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-medium">{c.name}</span>
                <span className="truncate text-sm text-muted-foreground">{c.email || formatPhone(c.phone)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim() && matches.length === 0 && !loadError && (
        <p className="text-sm text-muted-foreground">No match. Use New to add this customer.</p>
      )}
    </div>
  );
}
