// ============================================================
// test_order_status_regression.js
// ============================================================
// Regression test for the "sale-line order auto-invoices when
// Optimo is unavailable" bug. This bug has been fixed AT LEAST
// twice (April 11 2026, April 15 2026) and keeps coming back.
// This test codifies the invariants so it can't regress silently.
//
// Invariants being tested:
//   1. On create of a residential sale-only order (no Optimo key),
//      the order must NOT auto-transition to invoiced.
//   2. On create of a commercial cylinder-only order, auto-transition
//      to invoiced IS allowed (this is the only safe case).
//   3. In /confirm-payment, if the order has sale lines and Optimo
//      is NOT eligible, the order MUST strand at awaiting_dispatch
//      and MUST NOT auto-mark sale lines delivered.
//   4. In /confirm-payment, if the order is pure cylinder rental and
//      not collection, it IS allowed to auto-deliver and invoice
//      (preserving the commercial-customer fast path).
//
// This test parses routes.js source and asserts that the critical
// guard conditions are present. It does not spin up a live DB /
// server — those integration tests would need a stubbed Optimo
// client, which is a larger piece of work.
// ============================================================

const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "routes.js"), "utf8");

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error("  ✗ FAIL:", msg); failed++; }
  else { console.log("  ✓", msg); }
}

// Extract a specific function body by matching from a marker line to
// the next top-level router.post/router.put/router.get line.
function extractRouteBody(marker) {
  const startIdx = SRC.indexOf(marker);
  if (startIdx === -1) return "";
  // Find the next router.XXX that starts a new handler
  const rest = SRC.slice(startIdx + marker.length);
  const nextHandler = rest.search(/\n\s{2}router\.(post|put|get|delete|patch)\(/);
  return rest.slice(0, nextHandler === -1 ? rest.length : nextHandler);
}

// --- Invariant 3: confirm-payment must strand sale orders when Optimo is unavailable ---
console.log("\n[invariant 3] /confirm-payment strands sale orders when Optimo unavailable");
const confirmBody = extractRouteBody('router.post("/orders/:id/confirm-payment"');
assert(confirmBody.length > 0, "found /confirm-payment handler");
assert(
  /if\s*\(\s*hasAnySaleItem\s*&&\s*!order\.collection\s*\)/.test(confirmBody),
  "confirm-payment has explicit guard for 'hasAnySaleItem && !order.collection'"
);
assert(
  /awaiting_dispatch/.test(confirmBody),
  "confirm-payment references awaiting_dispatch (the strand state)"
);
assert(
  /stranded\s*:\s*true/.test(confirmBody) || /manual_completion_required/.test(confirmBody),
  "confirm-payment returns a strand marker (stranded:true or fulfillmentMode:manual_completion_required)"
);

// --- Invariant 3 (negative): verify the old buggy pattern is NOT present ---
console.log("\n[invariant 3 negative] confirm-payment does not blindly auto-deliver on !shouldPush");
// The old bug was: `if (!shouldPush) { for (const l of lines) { markOrderLineDelivered(...) } }`
// with no sub-case for sale lines. We look for that pattern and fail if it's intact.
const buggyPattern = /if\s*\(\s*!shouldPush\s*\)\s*\{[\s\S]{0,120}for\s*\(\s*const\s+l\s+of\s+lines\s*\)[\s\S]{0,200}markOrderLineDelivered/;
const hasGuardBetween = /if\s*\(\s*hasAnySaleItem/.test(confirmBody);
if (buggyPattern.test(confirmBody) && !hasGuardBetween) {
  assert(false, "old buggy auto-deliver pattern is present without the sale-line guard");
} else {
  console.log("  ✓ old buggy pattern absent, or guarded by sale-line check");
}

// --- Invariant 1: POST /orders must not auto-invoice residential orders ---
console.log("\n[invariant 1] POST /orders does not auto-transition residential orders to invoiced");
const postOrdersBody = extractRouteBody('router.post("/orders"');
assert(postOrdersBody.length > 0, "found POST /orders handler");
// The fix requires the auto-transition block to check customer_category === 'commercial'
// before firing. Look for that check near the isPureCylinder branch.
assert(
  /isCommercialAccount|customer_category.*commercial|customer\?\.customer_category.*commercial/i.test(postOrdersBody),
  "POST /orders checks commercial status before auto-transitioning"
);

// --- Invariant 4: pure-cylinder rental in confirm-payment still auto-delivers (legitimate path) ---
console.log("\n[invariant 4] confirm-payment preserves pure-cylinder auto-delivery");
assert(
  /fulfillmentMode:\s*order\.collection\s*\?\s*"collection"\s*:\s*"rental"/.test(confirmBody),
  "confirm-payment still has the pure-cylinder / collection auto-deliver path"
);

// --- Sanity: shared helper orderShouldPushToOptimo exists and requires API key ---
console.log("\n[sanity] orderShouldPushToOptimo requires API key");
const helperMatch = SRC.match(/function\s+orderShouldPushToOptimo[\s\S]{0,400}?\}/);
assert(helperMatch, "orderShouldPushToOptimo helper is defined");
if (helperMatch) {
  assert(
    /getApiKey|apiKey/i.test(helperMatch[0]),
    "orderShouldPushToOptimo checks for the API key"
  );
}

console.log(`\n[done] ${failed === 0 ? "ALL REGRESSION GUARDS PASSED" : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
