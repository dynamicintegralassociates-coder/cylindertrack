// Regression guards for the Order Status State Machine.
// See WORKING_FILE.md "Order Status State Machine" for the rules these enforce.
// Run: node test_order_state_machine.js
//
// These are source-level guards, not full integration tests. They catch the
// specific patterns that have caused production bugs. A proper integration
// suite with a stubbed Optimo client should be added when we stand up the
// test harness — tracked as follow-up.

const fs = require("fs");
const path = require("path");

const routes = fs.readFileSync(path.join(__dirname, "routes.js"), "utf8");
let failed = 0;
const check = (name, cond, detail) => {
  if (cond) { console.log("  ok  " + name); }
  else { console.log("FAIL  " + name + (detail ? "\n        " + detail : "")); failed++; }
};

console.log("Order Status State Machine — regression guards");

// Invariant 1: confirm-payment must never write status='dispatched' without
// first going through awaiting_dispatch. Look for the pattern of a single
// UPDATE that sets status='dispatched' from 'open' in one shot.
const badJump = /status\s*=\s*'dispatched'[^;]*WHERE id = \?\s*"\s*\)\.run\([^)]*\);?\s*(?!\s*\/\/ from awaiting_dispatch)/;
const hasAwaitingDispatchFirst = routes.includes("status = 'awaiting_dispatch'") &&
  routes.indexOf("status = 'awaiting_dispatch'") < routes.indexOf("pushOrderToOptimo(req.params.id)");
check(
  "confirm-payment sets awaiting_dispatch before calling pushOrderToOptimo",
  hasAwaitingDispatchFirst,
  "The Optimo-eligible branch must transition to awaiting_dispatch before the push, not jump to dispatched."
);

// Invariant 2: only successful Optimo push should set 'dispatched'. Every
// write of status='dispatched' should be preceded (within ~200 chars) by a
// successful pushResult check.
const dispatchedWrites = [...routes.matchAll(/status\s*=\s*'dispatched'/g)];
let allGuarded = true;
for (const m of dispatchedWrites) {
  const before = routes.slice(Math.max(0, m.index - 400), m.index);
  if (!/pushResult\.success|result\.success|optimoroute_id/.test(before)) {
    allGuarded = false;
    break;
  }
}
check(
  "every status='dispatched' write is guarded by a successful push result",
  allGuarded,
  "Found a write to status='dispatched' not preceded by a push-success check."
);

// Invariant 7: Manual Completion panel gate must stay status-based and
// include awaiting_dispatch and dispatched.
const app = fs.readFileSync(path.join(__dirname, "App.jsx"), "utf8");
check(
  "ManualCompletionPanel gated on open/awaiting_dispatch/dispatched",
  /\["open",\s*"awaiting_dispatch",\s*"dispatched"\]\.includes\(form\._editing_status\)/.test(app),
  "The panel visibility gate in App.jsx has changed — verify it still shows during the dispatchable window."
);

// Invariant 6: line-edit lock must include dispatched onward.
check(
  "line-edit lockedStates includes dispatched/delivered/invoiced/paid/cancelled",
  /lockedStates\s*=\s*\["dispatched",\s*"delivered",\s*"invoiced",\s*"paid",\s*"cancelled"\]/.test(routes),
  "Line-edit lock list has drifted from the documented state machine."
);

console.log(failed === 0 ? "\nAll guards passed." : "\n" + failed + " guard(s) failed.");
process.exit(failed === 0 ? 0 : 1);
