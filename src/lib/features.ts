/** Every feature switch, all off by default. Keys match backend `isFeatureOn`. */
export const FEATURES = [
  { key: 'tips', label: 'Tips' },
  { key: 'taxEngine', label: 'Tax engine' },
  { key: 'modifiers', label: 'Modifiers' },
  { key: 'openPrice', label: 'Open-price items' },
  { key: 'giftCards', label: 'Gift cards' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'loyalty', label: 'Loyalty' },
  { key: 'timeClock', label: 'Time clock' },
  { key: 'purchaseOrders', label: 'Purchase orders' },
  { key: 'customerDisplay', label: 'Customer display' },
  { key: 'pickup', label: 'Pickup' },
  { key: 'memberships', label: 'Memberships' },
  { key: 'accounting', label: 'Accounting' },
  { key: 'offline', label: 'Offline mode' },
  { key: 'webhooks', label: 'Webhooks' },
  { key: 'sms', label: 'SMS' },
] as const;
