
<!-- APPEND to WORKING_FILE.md under "Order Status State Machine", invariant #5 -->

- When `orderShouldPushToOptimo` returns false on an order with sale lines, the order must strand at `awaiting_dispatch` for manual completion — it must never fall through to the pure-cylinder mark-all-delivered branch.
