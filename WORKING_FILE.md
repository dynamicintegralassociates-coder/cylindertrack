# WORKING_FILE.md

Living process doc. Each section captures a rule or invariant the system must not regress on. Add new sections as we lock in more behavior.

---

## Order Status State Machine

### Valid states

`open` → `awaiting_dispatch` → `dispatched` → `delivered` → `invoiced` → `paid`

Plus `cancelled` as a terminal side-exit reachable from any pre-`delivered` state.

### Valid transitions

| From                | To                  | Trigger                                                             |
|---------------------|---------------------|---------------------------------------------------------------------|
| `open`              | `awaiting_dispatch` | Order confirmed (payment confirmed OR commercial terms), Optimo-eligible lines present, OR collection order awaiting manual dispatch |
| `open`              | `cancelled`         | User cancels                                                        |
| `awaiting_dispatch` | `dispatched`        | Successful OptimoRoute push (auto or manual resend) returns an `optimoroute_id` |
| `awaiting_dispatch` | `delivered`         | Manual Completion (failsafe) panel marks all lines delivered/returned while Optimo is unavailable |
| `awaiting_dispatch` | `cancelled`         | User cancels                                                        |
| `dispatched`        | `delivered`         | All lines complete — via POD webhook from Optimo OR manual completion panel |
| `dispatched`        | `cancelled`         | User cancels (rare; requires Optimo order to also be cancelled)     |
| `delivered`         | `invoiced`          | Invoice generated (automatic, immediately after `delivered`)        |
| `invoiced`          | `paid`              | Invoice `amount_paid >= total`                                      |

### Hard invariants (do NOT regress)

1. **Confirm-payment NEVER skips `awaiting_dispatch`.** Confirming an order that has any Optimo-eligible sale lines must land on `awaiting_dispatch`. Only a successful Optimo push advances it to `dispatched`. Only all-lines-complete advances it to `delivered`.
2. **Only a successful Optimo push sets `dispatched`.** Nothing else writes that status. Not confirm, not line edits, not invoice generation.
3. **`tryAutoTransitionToDelivered` is POD-driven, not confirm-driven.** It may only run after lines have actually been marked complete by (a) a real POD webhook, (b) the Manual Completion panel, or (c) the cylinder-only/collection fulfillment branch that explicitly marks lines delivered because there is nothing to dispatch. It must never run as a side effect of payment confirmation on orders that still have undispatched sale lines.
4. **Pure-cylinder rental-only orders and collection orders do not push to Optimo.** They go `open → awaiting_dispatch → delivered → invoiced` via the manual/collection path. The `dispatched` state is skipped intentionally for these — there is no route to dispatch.
5. **Mixed orders (cylinder + sale) follow the sale path.** They push to Optimo and must reach `dispatched` before `delivered`. The cylinder lines ride along and are settled at delivery time. They must NOT be routed through the pure-cylinder branch — this has been a recurring bug (see `routes.js:1256` comment).

   **Explicit rule (added April 2026 after second regression):** When `orderShouldPushToOptimo` returns false on an order with sale lines — for ANY reason, including a missing API key, network failure, or stale config — the order MUST strand at `awaiting_dispatch` for manual completion. It must NEVER fall through to the pure-cylinder mark-all-delivered branch. The sale line has not been fulfilled and must not be auto-invoiced. This invariant is enforced by `test_order_status_regression.js`.
6. **Line edits are frozen from `dispatched` onward.** Locked states: `dispatched`, `delivered`, `invoiced`, `paid`, `cancelled`. Header-field edits (notes, PO number) remain allowed until `invoiced`.
7. **Manual Completion panel visibility is gated on status**, not on line state or role. Visible when order status ∈ {`open`, `awaiting_dispatch`, `dispatched`}. Hidden at `delivered` and beyond. If the panel disappears when it shouldn't, the bug is almost always a premature status advance, not a frontend gate change — fix the backend.

### Known failure modes to test against

- Confirming a sale/mixed order must not land on `invoiced` (panel-hiding bug, daily-ops blocker).
- Confirming a pure-cylinder order must still reach `invoiced` via `awaiting_dispatch → delivered → invoiced`, never skipping `delivered`.
- A failed Optimo push must leave the order at `awaiting_dispatch` (not roll back to `open`, not advance to `dispatched`) so the dispatcher can retry or use the failsafe panel.
- POD webhook arriving for an already-`delivered` order must be idempotent (no double invoice).

---
