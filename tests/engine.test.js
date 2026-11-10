import { describe, it, expect } from 'vitest';
import {
  availableItems,
  compatible,
  recommend,
  swapOptions,
  logWear,
  markClean,
  saveCombo,
  archiveStaleCombos,
  logRejection,
  SLOTS,
  OPTIONAL_SLOTS,
} from '../src/engine.js';

const NOW = new Date('2026-11-10T08:00:00Z');

function item(overrides) {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    category: overrides.category ?? 'top',
    colors: overrides.colors ?? ['blue'],
    formality: overrides.formality ?? 3,
    rain_ok: overrides.rain_ok ?? false,
    tags: overrides.tags ?? [],
    photoBlobId: overrides.photoBlobId ?? null,
    archived: overrides.archived ?? false,
    dirty: overrides.dirty ?? false,
    lastWorn: overrides.lastWorn ?? null,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00Z',
  };
}

describe('availableItems — laundry modes', () => {
  const items = [
    item({ id: 't1', category: 'top', lastWorn: '2026-11-09T00:00:00Z', dirty: true }), // worn yesterday, dirty
    item({ id: 't2', category: 'top', lastWorn: null, dirty: false }), // never worn
    item({ id: 't3', category: 'top', lastWorn: '2026-11-01T00:00:00Z', dirty: false }), // worn 9 days ago
    item({ id: 't4', category: 'top', archived: true }), // archived — never available
  ];

  it('off mode: everything available except archived, regardless of dirty/lastWorn', () => {
    const result = availableItems(items, { laundryMode: 'off', autoResetDays: 3 }, NOW);
    expect(result.map((i) => i.id).sort()).toEqual(['t1', 't2', 't3']);
  });

  it('auto mode: excludes items worn within autoResetDays, includes once the window passes', () => {
    const result = availableItems(items, { laundryMode: 'auto', autoResetDays: 3 }, NOW);
    const ids = result.map((i) => i.id);
    expect(ids).not.toContain('t1'); // worn yesterday, within 3 day window
    expect(ids).toContain('t2'); // never worn
    expect(ids).toContain('t3'); // worn 9 days ago, past window
    expect(ids).not.toContain('t4');
  });

  it('full mode: excludes dirty items regardless of how long ago they were worn', () => {
    const result = availableItems(items, { laundryMode: 'full', autoResetDays: 3 }, NOW);
    const ids = result.map((i) => i.id);
    expect(ids).not.toContain('t1'); // dirty
    expect(ids).toContain('t2');
    expect(ids).toContain('t3'); // worn long ago but not dirty
  });
});

describe('compatible()', () => {
  it('rejects an item whose formality is too far from the target', () => {
    const casual = item({ id: 'a', formality: 1 });
    expect(compatible(casual, [], { formality: 5, rain: false })).toBe(false);
  });

  it('accepts an item within +-1 formality of the target', () => {
    const smartCasual = item({ id: 'a', formality: 3 });
    expect(compatible(smartCasual, [], { formality: 4, rain: false })).toBe(true);
  });

  it('rejects an item whose formality clashes with another chosen item', () => {
    const formal = item({ id: 'a', formality: 5 });
    const casual = item({ id: 'b', formality: 1 });
    expect(compatible(casual, [formal], { formality: 3, rain: false })).toBe(false);
  });

  it('rainy day: rejects items without rain_ok when rain is true', () => {
    const noRain = item({ id: 'a', formality: 3, rain_ok: false });
    expect(compatible(noRain, [], { formality: 3, rain: true })).toBe(false);
  });

  it('rainy day: accepts rain_ok items', () => {
    const rainOk = item({ id: 'a', formality: 3, rain_ok: true });
    expect(compatible(rainOk, [], { formality: 3, rain: true })).toBe(true);
  });
});

describe('recommend()', () => {
  const settings = { laundryMode: 'off', autoResetDays: 3 };

  it('prefers a saved combo over a generated one when the combo is fully available and matches', () => {
    const items = [
      item({ id: 'top1', category: 'top', formality: 3, rain_ok: true }),
      item({ id: 'bot1', category: 'bottom', formality: 3, rain_ok: true }),
      item({ id: 'shoe1', category: 'shoes', formality: 3, rain_ok: true }),
    ];
    const combos = [
      {
        id: 'c1',
        name: 'Saved fit',
        itemIds: { top: 'top1', bottom: 'bot1', outer: null, shoes: 'shoe1' },
        parentId: null,
        archived: false,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];
    const result = recommend(items, combos, { formality: 3, rain: false }, settings, NOW);
    expect(result.source).toBe('combo');
    expect(result.comboId).toBe('c1');
  });

  it('falls back to generating an outfit when no saved combo is fully available', () => {
    const items = [
      item({ id: 'top1', category: 'top', formality: 3, rain_ok: true }),
      item({ id: 'bot1', category: 'bottom', formality: 3, rain_ok: true }),
      item({ id: 'shoe1', category: 'shoes', formality: 3, rain_ok: true }),
    ];
    const result = recommend(items, [], { formality: 3, rain: false }, settings, NOW);
    expect(result.source).toBe('generated');
    expect(result.itemIds.top).toBe('top1');
    expect(result.itemIds.bottom).toBe('bot1');
    expect(result.itemIds.shoes).toBe('shoe1');
  });

  it('rainy day: a saved combo containing a non-rain_ok item is skipped in favor of generating', () => {
    const items = [
      item({ id: 'top1', category: 'top', formality: 3, rain_ok: false }),
      item({ id: 'top2', category: 'top', formality: 3, rain_ok: true }),
      item({ id: 'bot1', category: 'bottom', formality: 3, rain_ok: true }),
      item({ id: 'shoe1', category: 'shoes', formality: 3, rain_ok: true }),
    ];
    const combos = [
      {
        id: 'c1',
        name: 'No rain fit',
        itemIds: { top: 'top1', bottom: 'bot1', outer: null, shoes: 'shoe1' },
        parentId: null,
        archived: false,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];
    const result = recommend(items, combos, { formality: 3, rain: true }, settings, NOW);
    expect(result.source).toBe('generated');
    expect(result.itemIds.top).toBe('top2');
  });

  it('leaves the outer slot empty ("no layer") when nothing compatible is available', () => {
    const items = [
      item({ id: 'top1', category: 'top', formality: 3, rain_ok: true }),
      item({ id: 'bot1', category: 'bottom', formality: 3, rain_ok: true }),
      item({ id: 'shoe1', category: 'shoes', formality: 3, rain_ok: true }),
    ];
    const result = recommend(items, [], { formality: 3, rain: false }, settings, NOW);
    expect(result.itemIds.outer).toBeNull();
  });
});

describe('swapOptions()', () => {
  const settings = { laundryMode: 'off', autoResetDays: 3 };

  it('returns up to 3 compatible alternatives for a slot, excluding the current item', () => {
    const items = [
      item({ id: 'top1', category: 'top', formality: 3 }),
      item({ id: 'top2', category: 'top', formality: 3 }),
      item({ id: 'top3', category: 'top', formality: 3 }),
      item({ id: 'top4', category: 'top', formality: 3 }),
      item({ id: 'top5', category: 'top', formality: 5 }), // incompatible — too formal
    ];
    const current = { top: 'top1', bottom: null, outer: null, shoes: null };
    const options = swapOptions(items, current, 'top', { formality: 3, rain: false }, settings, NOW);
    const itemOptions = options.filter((o) => o.type === 'item');
    expect(itemOptions.length).toBe(3);
    expect(itemOptions.some((o) => o.item.id === 'top1')).toBe(false);
    expect(itemOptions.some((o) => o.item.id === 'top5')).toBe(false);
  });

  it('includes a "No layer" option for the optional outer slot', () => {
    const items = [item({ id: 'outer1', category: 'outer', formality: 3 })];
    const current = { top: null, bottom: null, outer: 'outer1', shoes: null };
    const options = swapOptions(items, current, 'outer', { formality: 3, rain: false }, settings, NOW);
    expect(OPTIONAL_SLOTS).toContain('outer');
    expect(options.some((o) => o.type === 'none')).toBe(true);
  });

  it('does not offer "No layer" for a required slot like shoes', () => {
    const items = [item({ id: 'shoe1', category: 'shoes', formality: 3 })];
    const current = { top: null, bottom: null, outer: null, shoes: 'shoe1' };
    const options = swapOptions(items, current, 'shoes', { formality: 3, rain: false }, settings, NOW);
    expect(options.some((o) => o.type === 'none')).toBe(false);
  });
});

describe('logWear()', () => {
  const wornDate = '2026-11-10T08:00:00Z';

  it('updates last_worn on every item in every laundry mode', () => {
    for (const mode of ['off', 'auto', 'full']) {
      const items = [item({ id: 't1', lastWorn: null }), item({ id: 'b1', category: 'bottom', lastWorn: null })];
      const { items: updated } = logWear(
        items,
        [],
        { itemIds: ['t1', 'b1'], comboId: null, date: wornDate, formalityTarget: 3, rain: false, oneOff: true },
        { laundryMode: mode, autoResetDays: 3 }
      );
      expect(updated.find((i) => i.id === 't1').lastWorn).toBe(wornDate);
      expect(updated.find((i) => i.id === 'b1').lastWorn).toBe(wornDate);
    }
  });

  it('only sets dirty=true in full mode, not off or auto', () => {
    for (const mode of ['off', 'auto']) {
      const items = [item({ id: 't1' })];
      const { items: updated } = logWear(
        items,
        [],
        { itemIds: ['t1'], comboId: null, date: wornDate, formalityTarget: 3, rain: false },
        { laundryMode: mode, autoResetDays: 3 }
      );
      expect(updated.find((i) => i.id === 't1').dirty).toBe(false);
    }
    const items = [item({ id: 't1' })];
    const { items: updated } = logWear(
      items,
      [],
      { itemIds: ['t1'], comboId: null, date: wornDate, formalityTarget: 3, rain: false },
      { laundryMode: 'full', autoResetDays: 3 }
    );
    expect(updated.find((i) => i.id === 't1').dirty).toBe(true);
  });

  it('wear_log_items (wearLog entries) is the source of truth for what was actually worn, even after a swap', () => {
    // outfit was recommended as top1+bot1, but the user swapped the top for top2 before wearing
    const items = [item({ id: 'top1' }), item({ id: 'top2', category: 'top' }), item({ id: 'bot1', category: 'bottom' })];
    const { wearLog } = logWear(
      items,
      [],
      { itemIds: ['top2', 'bot1'], comboId: 'c1', date: wornDate, formalityTarget: 3, rain: false, oneOff: false },
      { laundryMode: 'off', autoResetDays: 3 }
    );
    expect(wearLog).toHaveLength(1);
    expect(wearLog[0].itemIds.sort()).toEqual(['bot1', 'top2'].sort());
    expect(wearLog[0].itemIds).not.toContain('top1');
    expect(wearLog[0].comboId).toBe('c1');
  });
});

describe('markClean()', () => {
  it('clears the dirty flag only on the given items', () => {
    const items = [item({ id: 't1', dirty: true }), item({ id: 't2', dirty: true })];
    const updated = markClean(items, ['t1']);
    expect(updated.find((i) => i.id === 't1').dirty).toBe(false);
    expect(updated.find((i) => i.id === 't2').dirty).toBe(true);
  });
});

describe('saveCombo() — variant linking', () => {
  it('creates a new combo with no parent by default', () => {
    const { combo } = saveCombo([], { name: 'Weekday fit', itemIds: { top: 't1', bottom: 'b1', outer: null, shoes: 's1' } });
    expect(combo.parentId).toBeNull();
    expect(combo.name).toBe('Weekday fit');
  });

  it('links a variant combo to its parent via parentId', () => {
    const { combos, combo: parent } = saveCombo([], { name: 'Base fit', itemIds: { top: 't1', bottom: 'b1', outer: null, shoes: 's1' } });
    const { combos: combos2, combo: variant } = saveCombo(combos, {
      name: 'Base fit (with jacket)',
      itemIds: { top: 't1', bottom: 'b1', outer: 'o1', shoes: 's1' },
      parentId: parent.id,
    });
    expect(variant.parentId).toBe(parent.id);
    expect(combos2.find((c) => c.id === variant.id).parentId).toBe(parent.id);
  });
});

describe('archiveStaleCombos()', () => {
  it('archives combos not worn within staleDays', () => {
    const combos = [
      { id: 'c1', name: 'Old', itemIds: {}, parentId: null, archived: false, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'c2', name: 'Recent', itemIds: {}, parentId: null, archived: false, createdAt: '2026-01-01T00:00:00Z' },
    ];
    const wearLog = [{ id: 'w1', date: '2026-11-08T00:00:00Z', comboId: 'c2', itemIds: [] }];
    const result = archiveStaleCombos(combos, wearLog, 30, NOW);
    expect(result.find((c) => c.id === 'c1').archived).toBe(true); // never worn, created long ago
    expect(result.find((c) => c.id === 'c2').archived).toBe(false); // worn 2 days ago
  });

  it('does not touch already-archived combos', () => {
    const combos = [{ id: 'c1', name: 'Already gone', itemIds: {}, parentId: null, archived: true, createdAt: '2020-01-01T00:00:00Z' }];
    const result = archiveStaleCombos(combos, [], 30, NOW);
    expect(result[0].archived).toBe(true);
  });
});

describe('logRejection()', () => {
  it('appends a rejection entry without mutating the input array', () => {
    const rejections = [];
    const updated = logRejection(rejections, { context: 'swap', slot: 'top', itemId: 'top1', date: '2026-11-10T08:00:00Z' });
    expect(rejections).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(updated[0].slot).toBe('top');
    expect(updated[0].context).toBe('swap');
  });
});

describe('SLOTS', () => {
  it('includes the four core slots', () => {
    expect(SLOTS).toEqual(expect.arrayContaining(['top', 'bottom', 'outer', 'shoes']));
  });
});
