// Pure outfit-recommendation engine. No DOM, no IndexedDB — every function takes
// plain data in and returns plain data out, so it can be unit tested in isolation
// and reused unchanged by the UI layer.

export const SLOTS = ['top', 'bottom', 'outer', 'shoes'];
export const OPTIONAL_SLOTS = ['outer'];

export function daysBetween(dateA, dateB) {
  const a = new Date(dateA).getTime();
  const b = new Date(dateB).getTime();
  return Math.abs(b - a) / (1000 * 60 * 60 * 24);
}

function generateId() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
}

// --- Availability -----------------------------------------------------------
// laundry_mode is branched on ONLY here and in logWear(). Every other function
// just consumes whatever availableItems() already decided was wearable.
export function availableItems(items, settings, now = new Date()) {
  return items.filter((item) => {
    if (item.archived) return false;
    if (settings.laundryMode === 'full') return !item.dirty;
    if (settings.laundryMode === 'auto') {
      if (!item.lastWorn) return true;
      return daysBetween(item.lastWorn, now) >= settings.autoResetDays;
    }
    return true; // 'off'
  });
}

// --- Compatibility & scoring -------------------------------------------------
export function compatible(item, outfitItems, target) {
  if (target.rain && !item.rain_ok) return false;
  if (Math.abs(item.formality - target.formality) > 1) return false;
  for (const other of outfitItems) {
    if (Math.abs(item.formality - other.formality) > 1) return false;
  }
  return true;
}

export function scoreItem(item, target, now = new Date()) {
  let score = 0;
  score -= Math.abs(item.formality - target.formality) * 10;
  if (target.rain && item.rain_ok) score += 5;
  score += item.lastWorn ? Math.min(daysBetween(item.lastWorn, now), 30) : 30;
  return score;
}

function scoreCombo(comboItems, target, isSaved, now) {
  const base = comboItems.reduce((sum, item) => sum + scoreItem(item, target, now), 0);
  return isSaved ? base + 50 : base;
}

// --- Recommendation -----------------------------------------------------------
export function recommend(items, combos, target, settings, now = new Date()) {
  const available = availableItems(items, settings, now);
  const availableIds = new Set(available.map((i) => i.id));
  const itemById = new Map(items.map((i) => [i.id, i]));

  const candidateCombos = (combos || []).filter((combo) => {
    if (combo.archived) return false;
    return Object.values(combo.itemIds).every((id) => id == null || availableIds.has(id));
  });

  let bestCombo = null;
  let bestScore = -Infinity;
  for (const combo of candidateCombos) {
    const comboItems = Object.values(combo.itemIds)
      .filter(Boolean)
      .map((id) => itemById.get(id));
    if (target.rain && comboItems.some((it) => !it.rain_ok)) continue;
    if (comboItems.some((it) => Math.abs(it.formality - target.formality) > 1)) continue;
    const score = scoreCombo(comboItems, target, true, now);
    if (score > bestScore) {
      bestScore = score;
      bestCombo = combo;
    }
  }

  if (bestCombo) {
    return { source: 'combo', comboId: bestCombo.id, itemIds: { ...bestCombo.itemIds } };
  }

  const itemIds = {};
  for (const slot of SLOTS) {
    const chosenSoFar = Object.values(itemIds)
      .filter(Boolean)
      .map((id) => itemById.get(id));
    const candidates = available.filter((i) => i.category === slot);
    let best = null;
    let bestItemScore = -Infinity;
    for (const candidate of candidates) {
      if (!compatible(candidate, chosenSoFar, target)) continue;
      const score = scoreItem(candidate, target, now);
      if (score > bestItemScore) {
        bestItemScore = score;
        best = candidate;
      }
    }
    itemIds[slot] = best ? best.id : null;
  }

  return { source: 'generated', comboId: null, itemIds };
}

// --- Swaps ----------------------------------------------------------------
export function swapOptions(items, currentItemIds, slot, target, settings, now = new Date()) {
  const available = availableItems(items, settings, now);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const otherItems = Object.entries(currentItemIds)
    .filter(([s]) => s !== slot)
    .map(([, id]) => id)
    .filter(Boolean)
    .map((id) => itemById.get(id))
    .filter(Boolean);

  const candidates = available.filter((i) => i.category === slot && i.id !== currentItemIds[slot]);
  const compatibleCandidates = candidates.filter((c) => compatible(c, otherItems, target));
  const scored = compatibleCandidates
    .map((item) => ({ item, score: scoreItem(item, target, now) }))
    .sort((a, b) => b.score - a.score);

  const options = scored.slice(0, 3).map(({ item }) => ({ type: 'item', item }));
  if (OPTIONAL_SLOTS.includes(slot)) {
    options.push({ type: 'none' });
  }
  return options;
}

// --- Wear logging -----------------------------------------------------------
// wearLog is the source of truth for what was actually worn: callers pass the
// final itemIds (after any swaps), not the original recommendation.
export function logWear(items, wearLog, wear, settings) {
  const { itemIds, comboId = null, date, formalityTarget, rain, oneOff = false } = wear;
  const wornSet = new Set(itemIds);

  const updatedItems = items.map((item) => {
    if (!wornSet.has(item.id)) return item;
    const updated = { ...item, lastWorn: date };
    if (settings.laundryMode === 'full') updated.dirty = true;
    return updated;
  });

  const entry = {
    id: generateId(),
    date,
    comboId,
    itemIds: [...itemIds],
    formalityTarget,
    rain: !!rain,
    oneOff: !!oneOff,
  };

  return { items: updatedItems, wearLog: [...wearLog, entry] };
}

export function markClean(items, itemIds) {
  const idSet = new Set(itemIds);
  return items.map((item) => (idSet.has(item.id) ? { ...item, dirty: false } : item));
}

// --- Combos -----------------------------------------------------------------
export function saveCombo(combos, { name, itemIds, parentId = null }) {
  const combo = {
    id: generateId(),
    name,
    itemIds: { ...itemIds },
    parentId,
    archived: false,
    createdAt: new Date().toISOString(),
  };
  return { combos: [...combos, combo], combo };
}

export function archiveStaleCombos(combos, wearLog, staleDays, now = new Date()) {
  return combos.map((combo) => {
    if (combo.archived) return combo;
    const wears = wearLog.filter((w) => w.comboId === combo.id);
    const lastWornDate = wears.length
      ? wears.reduce((latest, w) => (w.date > latest ? w.date : latest), wears[0].date)
      : combo.createdAt;
    const days = daysBetween(lastWornDate, now);
    return days >= staleDays ? { ...combo, archived: true } : combo;
  });
}

// --- Rejections ---------------------------------------------------------------
export function logRejection(rejections, { context, slot = null, itemId = null, comboId = null, reason = null, date }) {
  const entry = { id: generateId(), date, context, slot, itemId, comboId, reason };
  return [...rejections, entry];
}
