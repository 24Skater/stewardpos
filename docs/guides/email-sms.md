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
