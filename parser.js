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

  // Detect a "rental" hint anywhere in the text.
  // Use a simple includes() check rather than \b word-boundary so that joined
  // formats like "1xrental 45kg" (no space between x and rental) are caught.
  const wantsRental = lower.includes("rental");

  // Rental/sale preference bonus — shared by all patterns.
  function rentalBonus(ct) {
    const label = ct.label.toLowerCase();
    const isRentalType = label.includes("rental") || ct.item_type === "cylinder";
    const isSaleType = ct.item_type === "sale";
    if (wantsRental && isRentalType) return 50;
    if (wantsRental && isSaleType) return -50;
    if (!wantsRental && isSaleType) return 50;
    if (!wantsRental && isRentalType) return -50;
    return 0;
  }

  // Score-and-rank a candidate against the user's intent. Higher = better match.
  // Returns -1 if the candidate doesn't match the size at all.
  function scoreCandidate(ct, size) {
    const label = ct.label.toLowerCase();

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

    let score = 100 + rentalBonus(ct);
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
      if (s > bestScore) { bestScore = s; best = ct; }
    }
    if (best && bestScore >= 0) {
      // If wantsRental but the best scored match is a plain sale type, try a second
      // pass specifically for rental types that contain the size in their label.
      const bestIsOnlySale = wantsRental && best && best.item_type === "sale" &&
        !best.label.toLowerCase().includes("rental");
      if (bestIsOnlySale) {
        let rentalBest = null, rentalBestScore = -1;
        for (const ct of cylinderTypes) {
          if (ct.item_type !== "cylinder" && !ct.label.toLowerCase().includes("rental")) continue;
          if (!ct.label.toLowerCase().includes(size)) continue;
          const s = 100 + rentalBonus(ct);
          if (s > rentalBestScore) { rentalBestScore = s; rentalBest = ct; }
        }
        if (rentalBest) return { cylinderType: rentalBest, qty };
      }
      return { cylinderType: best, qty };
    }
    // Loose match: label merely contains the size string
    let looseBest = null, looseBestScore = -1;
    for (const ct of cylinderTypes) {
      const label = ct.label.toLowerCase();
      if (!label.includes(size)) continue;
      const s = 50 + rentalBonus(ct);
      if (s > looseBestScore) { looseBestScore = s; looseBest = ct; }
    }
    if (looseBest) return { cylinderType: looseBest, qty };
  }

  // Pattern 1b: NxWORD — e.g. "2xrental 45kg", "1xrental 45kg lpg"
  // Pattern 1 above only fires when the character after 'x' is a digit. If it's a
  // letter (e.g. "1xrental"), extract the leading N as quantity and re-parse the rest.
  const nxWordMatch = !nxMatch && lower.match(/^(\d+)\s*x\s*([a-z].+)/);
  if (nxWordMatch) {
    const qty = parseInt(nxWordMatch[1]);
    const rest = nxWordMatch[2];
    const sub = parseCylinderFromText(rest, cylinderTypes);
    if (sub.cylinderType) return { cylinderType: sub.cylinderType, qty };
  }

  // Pattern 2: "N WORD" or "N WORD extra" (e.g. "2 Cage", "2 Cage acc", "1 cage")
  const nWordMatch = lower.match(/^(\d+)\s+([a-z][a-z\s]*)/);
  if (nWordMatch) {
    const qty = parseInt(nWordMatch[1]);
    const word = nWordMatch[2].trim();
    let best = null, bestScore = -1;
    for (const ct of cylinderTypes) {
      const label = ct.label.toLowerCase();
      if (!label.includes(word) && !word.includes(label)) continue;
      let s = 50 + rentalBonus(ct);
      if (label === word) s += 20;
      else if (label.startsWith(word) || word.startsWith(label)) s += 10;
      if (s > bestScore) { bestScore = s; best = ct; }
    }
    if (best) return { cylinderType: best, qty };
  }

  // Pattern 3: Just a size like "45kg" or "8.5kg"
  const kgMatch = lower.match(/([\d.]+)\s*kg/);
  if (kgMatch) {
    const size = kgMatch[1];
    let best = null, bestScore = -1;
    for (const ct of cylinderTypes) {
      const label = ct.label.toLowerCase();
      if (!label.includes(size + "kg") && !label.includes(size + " kg") && label !== size) continue;
      const s = 50 + rentalBonus(ct);
      if (s > bestScore) { bestScore = s; best = ct; }
    }
    if (best) return { cylinderType: best, qty: 1 };
  }

  // Pattern 4: Direct label match (e.g. "Cage", "Oxygen", "45 Rental").
  // Scored so rental/sale preference is respected, and a more-specific label
  // beats a label that is merely a substring of the input.
  {
    let best = null, bestScore = -1;
    for (const ct of cylinderTypes) {
      const label = ct.label.toLowerCase();
      const inputContainsLabel = lower.includes(label);
      const labelContainsInput = label.includes(lower);
      if (!inputContainsLabel && !labelContainsInput) continue;
      let s = 50 + rentalBonus(ct);
      if (label === lower) s += 30;
      else if (labelContainsInput) s += 10;
      else if (inputContainsLabel) s += 5;
      if (s > bestScore) { bestScore = s; best = ct; }
    }
    if (best) return { cylinderType: best, qty: 1 };
  }

  return { cylinderType: null, qty: 0 };
}

module.exports = { parseCylinderFromText };
