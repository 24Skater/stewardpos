import db from './database';

export type TemplateChannel = 'email' | 'sms';

interface TemplateDef {
  /** Variables the template may use; anything else renders blank. */
  vars: readonly string[];
  subject: string;
  body: string;
  sample: Record<string, string>;
}

export const TEMPLATE_KEYS: Record<string, TemplateDef> = {
  receipt: {
    vars: ['receipt', 'orderId'],
    subject: 'Receipt #{{orderId}}',
    body: '{{receipt}}',
    sample: { receipt: '1 x Tea  $5.00\nTotal  $5.00', orderId: 'ORD-1234' },
  },
  gift_card: {
    vars: ['code', 'amount', 'recipientName'],
    subject: 'Your gift card',
    body: 'Hello {{recipientName}}, your gift card code is {{code}} for {{amount}}.',
    sample: { code: 'GC-1234-5678', amount: '$25.00', recipientName: 'Sam' },
  },
  invoice: {
    vars: ['number', 'customerName', 'total', 'dueDate'],
    subject: 'Invoice {{number}}',
    body: 'Hello {{customerName}}, invoice {{number}} for {{total}} is due {{dueDate}}.',
    sample: { number: 'INV-0042', customerName: 'Sam', total: '$120.00', dueDate: '2026-01-31' },
  },
  quote: {
    vars: ['number', 'customerName', 'total', 'validUntil'],
    subject: 'Quote {{number}}',
    body: 'Hello {{customerName}}, quote {{number}} for {{total}} is valid until {{validUntil}}.',
    sample: { number: 'Q-0007', customerName: 'Sam', total: '$300.00', validUntil: '2026-02-15' },
  },
  purchase_order: {
    vars: ['number', 'supplierName', 'total'],
    subject: 'Purchase order {{number}}',
    body: 'Hello {{supplierName}}, please find purchase order {{number}} for {{total}}.',
    sample: { number: 'PO-0019', supplierName: 'Acme Supply', total: '$1,200.00' },
  },
  membership_reminder: {
    vars: ['memberName', 'planName', 'renewalDate'],
    subject: 'Your membership renews soon',
    body: 'Hello {{memberName}}, your {{planName}} membership renews on {{renewalDate}}.',
    sample: { memberName: 'Sam', planName: 'Family', renewalDate: '2026-03-01' },
  },
  pickup_ready: {
    vars: ['customerName', 'orderId'],
    subject: 'Your order is ready',
    body: 'Hello {{customerName}}, order {{orderId}} is ready for pickup.',
    sample: { customerName: 'Sam', orderId: 'ORD-1234' },
  },
};

export interface RenderedTemplate {
  enabled: boolean;
  subject: string;
  text: string;
  /** Email only. Variable values are escaped; the template text is the admin's own. */
  html?: string;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (v: string): string => v.replace(/[&<>"']/g, (c) => ESCAPES[c]);

function substitute(template: string, vars: Record<string, string>, escape: boolean): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) => {
    const value = Object.hasOwn(vars, name) ? vars[name] : '';
    return escape ? escapeHtml(value) : value;
  });
}

/** Pure rendering, shared by the live path and the preview. */
export function renderParts(
  channel: TemplateChannel,
  subject: string,
  body: string,
  vars: Record<string, string>
): Omit<RenderedTemplate, 'enabled'> {
  return {
    subject: substitute(subject, vars, false),
    text: substitute(body, vars, false),
    ...(channel === 'email' ? { html: substitute(body, vars, true).replace(/\n/g, '<br>') } : {}),
  };
}

export async function getTemplate(key: string, channel: TemplateChannel) {
  const def = TEMPLATE_KEYS[key];
  const rows = await db.getAdapter().getMessageTemplates();
  const row = rows.find((r) => r.key === key && r.channel === channel);
  return {
    key,
    channel,
    subject: row?.subject ?? def.subject,
    body: row?.body ?? def.body,
    enabled: row?.enabled ?? true,
    isDefault: !row,
  };
}

/** Looks up the stored template (or the built-in default) and renders it. */
export async function renderTemplate(
  key: string,
  channel: TemplateChannel,
  vars: Record<string, string>
): Promise<RenderedTemplate> {
  const t = await getTemplate(key, channel);
  return { enabled: t.enabled, ...renderParts(channel, t.subject, t.body, vars) };
}
