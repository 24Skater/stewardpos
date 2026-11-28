# Email and SMS

## Email

Choose the email provider under **Admin > Settings > Email**: Off, SMTP or Resend.
Credentials are stored encrypted (they need `CREDENTIALS_KEY`, as for payments) and are never
shown again; leave a field blank to keep the stored value.

- **Off** sends nothing. A send attempt is recorded as `failed` with "Email is off".
- **Not chosen yet**: installs that never touched this setting keep using the environment
  variables (`EMAIL_ADAPTER`, `EMAIL_SMTP_*`, `RESEND_API_KEY`), so upgrading changes nothing.
- **Test send**: save first, then enter an address and press Test send. The result is the real
  outcome from the provider.

Only `sent` means a provider accepted the message. `logged` means it was written to the server
log because no provider is configured; it was not delivered.

### Delivery log

**Admin > Messages** lists every send attempt (time, template, recipient, status, and the
provider's message id or the error). Each attempt is one row in the `message_log` table.

Check your local rules on when you may email customers, and keep consent records accordingly.

## Message templates

**Admin > Templates** edits the subject and body of each message, previews it with sample data,
and switches it on or off. With no edit, a built-in default is used. A switched-off template
sends nothing and is recorded in the delivery log as `suppressed`. Variables are written
`{{name}}`; an unknown name renders blank, and values are HTML-escaped in the email version.

| Key | Variables |
|-----|-----------|
| `receipt` | `receipt`, `orderId` |
| `gift_card` | `code`, `amount`, `recipientName` |
| `invoice` | `number`, `customerName`, `total`, `dueDate` |
| `quote` | `number`, `customerName`, `total`, `validUntil` |
| `purchase_order` | `number`, `supplierName`, `total` |
| `membership_reminder` | `memberName`, `planName`, `renewalDate` |
| `pickup_ready` | `customerName`, `orderId` |

Only `receipt` is sent today (receipt resend); the others are defined for the features that use them.

## SMS

Choose the provider under **Admin > Settings > SMS**: Off, Twilio, or an HTTP gateway (any service
that accepts `{"to", "body"}` as JSON with a bearer token). Credentials are stored encrypted, like email.

- **Consent first.** A text is sent only to a number marked opted in. Tick "Customer agreed to receive
  text messages" on the customer form. Anything else is recorded as `suppressed` in Admin > Messages.
- **STOP and START.** Point your Twilio number's incoming-message webhook at
  `https://<your-host>/api/webhooks/twilio`. STOP, UNSUBSCRIBE and similar replies opt the number out;
  START opts it back in. Requests are checked against `X-Twilio-Signature` using the auth token.
- **Quiet hours.** Set a start and end time; texts inside the window (in the store time zone, and it may
  cross midnight) are `suppressed`, not delayed.
- **Off** means unavailable: attempts are logged as `failed` with "SMS is off".
- **Test send** goes through the same rules, so the number must already have opted in.

Consent rules vary by state and country; check yours.
