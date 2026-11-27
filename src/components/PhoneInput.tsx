import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { formatPhone, phoneDigits } from "@/lib/phone";

type PhoneInputProps = Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  /** Bare digits, as stored. */
  value: string;
  onChange: (digits: string) => void;
};

/** Accepts digits only and formats as you type; hands back bare digits. */
export default function PhoneInput({ value, onChange, ...rest }: PhoneInputProps) {
  return (
    <Input
      placeholder="(555) 123-4567"
      {...rest}
      type="tel"
      inputMode="numeric"
      autoComplete="tel"
      value={formatPhone(value)}
      onChange={(e) => onChange(phoneDigits(e.target.value))}
    />
  );
}
