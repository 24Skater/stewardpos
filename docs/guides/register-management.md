# Register management

How to run a store with more than one till.

Before this existed, StewardPOS had no concept of a register at all: one implicit
till, one cash drawer for the whole installation, and no record of which machine
or which person rang a sale. This guide covers what a register is now, how to set
one up, and what to do when one breaks.

---

## What a register is

A **location** is a site — an address, a timezone. A **register** is a till at
that site. Registers belong to locations; locations belong to your organisation.

```
Organisation
└── Location            "Church Hall", 12 Example Street, Europe/London
    ├── Register 1      CHURCH-HALL-01   fixed, cash drawer
    ├── Register 2      CHURCH-HALL-02   fixed, cash drawer
    └── Register 3      CHURCH-HALL-03   web, no drawer
```

Each register carries three identifiers, and they do different jobs:

| | Example | Who sets it | What it is for |
|---|---|---|---|
| ID | `01J8ZQ…` | Generated | Foreign keys. Never shown to anyone. |
| Number | `1`, `2`, `3` | Generated, **per location** | What staff say out loud. "Register 1" can exist at two sites. |
| Display code | `CHURCH-HALL-01` | Generated from the location | Printed on receipts, shown in reports. Unique across your organisation. |

You choose the **name** ("Coffee Shop Till", "Mobile Stall") and the
**placement** ("1st floor coffee shop"). Everything else is assigned.

---

## Capabilities

A register's type and its capabilities are separate questions, and both matter.

**Type** — `fixed`, `mobile`, `web`, or `kiosk` — is what kind of thing it is.

**Capabilities** are what it is allowed to do:

| Capability | When it is off |
|---|---|
| `Has cash drawer` | The register cannot open a drawer session at all. A web till with no physical drawer must have this off, or your variance report fills with sessions that have no money behind them. |
| `Accepts cash` | Cash tenders are refused — including the cash leg of a split payment. This is how you run a card-only lane. |
| `Can refund` | Refunds are refused at this till. |
| `Can open drawer with no sale` | The no-sale button is unavailable. Leave this off unless you need it; see [loss prevention](#loss-prevention) below. |

These are enforced on the server, not merely hidden in the interface.

---

## Setting up a register

1. **Create the location** — Admin → Registers → add a location with its address
   and timezone. The timezone matters: reports bucket a site's day in its own
   clock, so a travelling register does not smear across two days.
2. **Create the register** under that location. The number and display code are
   assigned for you.
3. **Pair the device.** Generate a pairing code and enter it on the terminal at
   `/pair`. The code is eight characters, valid for fifteen minutes, and usable
   once.
4. The register moves from `pending` to `active` and can trade.

Generating a pairing code for a register that is **already paired and trading is
safe** — the existing device keeps working until the new one actually pairs.

### Register states

| State | Meaning |
|---|---|
| `pending` | Exists, but has no device credential. Cannot trade. |
| `active` | Paired and trading. |
| `disabled` | Temporarily switched off. Keeps its credential and its licence slot. |
| `retired` | Permanently decommissioned. Its number and display code are **never** reused, so old receipts always resolve to the till that printed them. |

A register with sales is never deleted, only retired. Retired registers still
appear in reports covering periods when they traded.

---

## Card readers

Merchant credentials — your Stripe secret key, your Square access token — belong
to the **store**, because they identify your account.

The **device ID** belongs to the **register**, because it identifies one physical
reader. Set it per register (Admin → Registers → edit → Terminal). Leave it blank
and the register falls back to the store-wide device, which is what a
single-register shop wants.

A register may also override the **provider**, so a shop replacing readers one
lane at a time can run mixed hardware rather than swapping everything at once.

---

## Cashier sign-in

Turn on **Require sign-in** for a register and a cashier must enter their PIN
before ringing a sale. Sales then attribute to that person rather than to
whoever logged the browser in.

- PINs are **six digits minimum**, set by an admin (Admin → Roles & Users), and
  never displayed again afterwards.
- A PIN must be unique across your organisation. If two people shared one,
  attribution would be a coin flip.
- Five wrong attempts locks that PIN for fifteen minutes. It clears on its own —
  nobody needs to be called.
- The till locks itself after the register's idle timeout (five minutes by
  default) and the cart survives the lock.

Clearing someone's PIN revokes their ability to sign on to any till. It does not
end a shift they already have open; their next sign-on is what fails.

---

## Manager overrides

Some actions need a supervisor. Rather than logging the cashier out — which loses
the cart and misattributes the sale — a supervisor enters their PIN and
authorises **that one action**.

A grant is good for one named action, for ninety seconds, once.

Currently gated:

- a discount past its approval threshold
- closing a drawer more than your variance threshold short
- voiding a sale
- opening the drawer with no sale

Give someone approver rights in Admin → Roles & Users. It is deliberately
separate from their role permissions: who you trust to stand behind an exception
is a different question from which admin screens they may open.

Every grant is recorded at Admin → Manager Overrides, **including grants nobody
used** — a supervisor being called over repeatedly and declining is worth seeing.

---

## Loss prevention

Two reports are worth reading regularly:

**Drawer variance by register** — sessions, total variance, worst single
variance, and how many closed short. A till that is consistently short is the
thing this exists to surface.

**No-sale counts** — how often each register opened its drawer with no sale
attached. This is the single best theft signal a POS has, which is why the action
requires a supervisor and writes a record.

Set a variance threshold for your organisation so that closing short needs an
override rather than passing quietly.

---

## When something breaks

**A terminal is lost or stolen.** Revoke the register (Admin → Registers →
Revoke). The device stops working immediately and the register returns to
`pending`. Re-pairing is required — this is not the same as disabling it.

If that register has a **drawer open**, revocation is refused. Either close the
drawer properly, or force it: the session is closed at its expected cash and
flagged for review. Forcing creates a variance on purpose, so do it knowingly.

**A till is replaced.** Create the pairing code, pair the new hardware, and the
old device loses access at that moment. Retire the old register if it is gone for
good; its number will not be reused.

**A register shows as offline.** Registers heartbeat every sixty seconds.
`online` is under two minutes, `idle` under fifteen, `offline` beyond that, and
`never` means it has not checked in since pairing. An offline register usually
means the browser is closed or the network is down; it does not revoke anything.

---

## Reporting

Admin → Reports carries the register views:

- **Sales by register**, with the web-versus-drawer split
- **Sales by cashier** — what sign-in makes possible
- **Sales by location**
- **Drawer variance** and **no-sale counts**
- **Hourly trading per register**, for staffing

All of them filter by register, location and cashier, and export.

Sales attribute to the cashier who was signed on **at the time of the sale**, not
whoever is on the till when you run the report.

---

## Related

- [Operations](operations.md) — backups, monitoring, day-to-day running
- [Multi-tenant](multi-tenant.md) — organisations
- [Environment reference](../reference/environment.md) — configuration
