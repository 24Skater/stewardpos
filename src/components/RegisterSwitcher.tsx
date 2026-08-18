import { useEffect, useState } from 'react';
import { Monitor, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useRegisters } from '@/hooks/queries';
import {
  clearSelectedRegisterId,
  getSelectedRegisterId,
  setSelectedRegisterId,
  subscribeToSelectedRegisterId,
} from '@/lib/register-device';

/**
 * Which till this terminal is ringing sales against.
 *
 * A minimal switcher: every active register in the org, in a dropdown, with
 * the current choice checked. Device enrolment (a later phase) will replace
 * this with something that knows which physical machine it is running on;
 * until then, a cashier picks it by hand and the browser remembers the
 * choice (see `lib/register-device.ts`).
 *
 * When the stored register id no longer names an active register — it was
 * retired or disabled from another terminal — the selection is cleared
 * rather than kept, so requests fall back to the backend's own default
 * instead of sending a header it will reject.
 */
export default function RegisterSwitcher() {
  const { data: registers } = useRegisters({ status: 'active' });
  const [selectedId, setLocalSelectedId] = useState<string | null>(() => getSelectedRegisterId());

  useEffect(() => subscribeToSelectedRegisterId(setLocalSelectedId), []);

  useEffect(() => {
    if (!registers || selectedId === null) return;

    const stillValid = registers.some((register) => register.id === selectedId);
    if (!stillValid) {
      clearSelectedRegisterId();
    }
  }, [registers, selectedId]);

  const selected = registers?.find((register) => register.id === selectedId) ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="border-border" size="sm">
          <Monitor className="w-4 h-4 mr-1" />
          {selected ? selected.displayCode : 'Register: Auto'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Switch register</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {!registers || registers.length === 0 ? (
          <DropdownMenuItem disabled>No active registers</DropdownMenuItem>
        ) : (
          registers.map((register) => (
            <DropdownMenuItem
              key={register.id}
              onClick={() => setSelectedRegisterId(register.id)}
            >
              <Check
                className={`w-4 h-4 mr-2 ${register.id === selectedId ? 'opacity-100' : 'opacity-0'}`}
              />
              {register.displayCode}
              {register.name ? <span className="ml-2 text-muted-foreground">{register.name}</span> : null}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
