export interface FeatureSettings {
  features?: Record<string, boolean> | null;
  providers?: Record<string, unknown> | null;
}

/** A feature is on only when explicitly switched on; unknown keys are off. */
export function isFeatureOn(settings: FeatureSettings | null | undefined, key: string): boolean {
  return settings?.features?.[key] === true;
}

/** `providers[key]` is either a name or `{ provider, credentials }`; unset means 'off'. */
export function providerFor(settings: FeatureSettings | null | undefined, key: string): string {
  const entry = settings?.providers?.[key];
  const name = typeof entry === 'string' ? entry : (entry as { provider?: unknown } | null | undefined)?.provider;
  return typeof name === 'string' && name ? name : 'off';
}
