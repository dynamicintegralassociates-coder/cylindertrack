const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseCylinderFromText } = require("../parser");

const TYPES = [
  { id: "s15", label: "15",         item_type: "sale" },
  { id: "r15", label: "15 rental",  item_type: "cylinder" },
  { id: "s45", label: "45",         item_type: "sale" },
  { id: "r45", label: "45 rental",  item_type: "cylinder" },
  { id: "s85", label: "8.5",        item_type: "sale" },
  { id: "r85", label: "8.5 rental", item_type: "cylinder" },
];

const cases = [
  ["5x45",           "s45", 5],
  ["5x45rental",     "r45", 5],
  ["5x 45 rental",   "r45", 5],
  ["5x 45rental",    "r45", 5],
  ["1x15",           "s15", 1],
  ["1x 15 rental",   "r15", 1],
  ["2x8.5",          "s85", 2],
  ["2x 8.5 rental",  "r85", 2],
  ["4x45",           "s45", 4],
];
for (const [input, expectedId, expectedQty] of cases) {
  test(`parse "${input}" → ${expectedId} × ${expectedQty}`, () => {
    const r = parseCylinderFromText(input, TYPES);
    assert.equal(r.cylinderType?.id, expectedId);
    assert.equal(r.qty, expectedQty);
  });
}

test("garbage input returns null", () => {
  assert.equal(parseCylinderFromText("xyz", TYPES).cylinderType, null);
});
