// parser.js — pure functions for parsing customer order detail text into cylinder types
// and quantities. Extracted from routes.js in 3.0.18 so it can be unit-tested in isolation
// without pulling in express, better-sqlite3, etc.
//
// CHANGES MUST KEEP THE PARSER PURE: no side effects, no requires of other project files,
// no DB access. The cylinderTypes argument is the only data input.

function parseCylinderFromText(text, cylinderTypes) {
  if (!text || cylinderTypes.length === 0) return { cylinderType: null, qty: 0 };

  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // 3.0.15: Detect a "rental" / "sale" hint in the text. If the user typed "5x45 rental"
  // or "5x45rental" we should pick the rental cylinder type, not the sale one. Conversely
  // if they typed plain "5x45", they meant the bare item (sale).
  const wantsRental = /\brental\b/.test(lower) || /rental\s*$/.test(lower) || lower.endsWith("rental");

  // Score-and-rank a candidate against the user's intent. Higher = better match.
  // Returns -1 if the candidate doesn't match the size at all.
  function scoreCandidate(ct, size) {
    const label = ct.label.toLowerCase();
    const isRentalType = label.includes("rental") || ct.item_type === "cylinder";
    const isSaleType = ct.item_type === "sale";

    const sizeRegex = new RegExp(`\\b${size.replace('.', '\\.')}\\b|^${size.replace('.', '\\.')}kg|^${size.replace('.', '\\.')}\\s*kg`);
    const sizeMatches =
      sizeRegex.test(label) ||
      label === size ||
      label.startsWith(size + "kg") ||
      label.startsWith(size + " kg") ||
      label.startsWith(size + " ") ||
      label === size + " rental" ||
      label.startsWith(size + " rental");
    if (!sizeMatches) return -1;

    let score = 100;
    if (wantsRental && isRentalType) score += 50;
    if (wantsRental && isSaleType) score -= 50;
    if (!wantsRental && isSaleType) score += 50;
    if (!wantsRental && isRentalType) score -= 50;
    if (label === size) score += 10;
    if (label === size + " rental") score += 10;
    return score;
  }

  // Pattern 1: NxSIZE with decimals (e.g. "2x45", "1x8.5", "5x 45 rental", "5x45rental")
  const nxMatch = lower.match(/^(\d+)\s*x\s*([\d.]+)/);
  if (nxMatch) {
    const qty = parseInt(nxMatch[1]);
    const size = nxMatch[2];

    let best = null;
    let bestScore = -1;
    for (const ct of cylinderTypes) {
      const s = scoreCandidate(ct, size);
      if (s > bestScore) {
        bestScore = s;
        best = ct;
      }
    }
    if (best && bestScore >= 0) {
      return { cylinderType: best, qty };
    }
    let looseBest = null;
    let looseBestScore = -1;
    for (const ct of cylinderTypes) {
      const label = ct.label.toLowerCase();
      if (!label.includes(size)) continue;
      const isRentalType = label.includes("rental") || ct.item_type === "cylinder";
      const isSaleType = ct.item_type === "sale";
      let s = 50;
      if (wantsRental && isRentalType) s += 50;
      if (wantsRental && isSaleType) s -= 50;
      if (!wantsRental && isSaleType) s += 50;
      if (!wantsRental && isRentalType) s -= 50;
      if (s > looseBestScore) {
        looseBestScore = s;
        looseBest = ct;
      }
    }
    if (looseBest) return { cylinderType: looseBest, qty };
  }

  // Pattern 2: "N WORD" or "N WORD extra" (e.g. "2 Cage", "2 Cage acc", "1 cage")
  const nWordMatch = lower.match(/^(\d+)\s+([a-z][a-z\s]*)/);
  if (nWordMatch) {
    const qty = parseInt(nWordMatch[1]);
    const word = nWordMatch[2].trim();
    for (const ct of cylinderTypes) {
      const label = ct.label.toLowerCase();
      if (label.includes(word) || word.includes(label)) {
        return { cylinderType: ct, qty };
      }
    }
  }

  // Pattern 3: Just a size like "45kg" or "8.5kg"
  const kgMatch = lower.match(/([\d.]+)\s*kg/);
  if (kgMatch) {
    const size = kgMatch[1];
    for (const ct of cylinderTypes) {
      const label = ct.label.toLowerCase();
      if (label.includes(size + "kg") || label.includes(size + " kg") || label === size) {
        return { cylinderType: ct, qty: 1 };
      }
    }
  }

  // Pattern 4: Direct label match (e.g. "Cage", "Oxygen")
  for (const ct of cylinderTypes) {
    if (lower.includes(ct.label.toLowerCase()) || ct.label.toLowerCase().includes(lower)) {
      return { cylinderType: ct, qty: 1 };
    }
  }

  return { cylinderType: null, qty: 0 };
}

module.exports = { parseCylinderFromText };
