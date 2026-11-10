import * as db from '../db.js';
import * as engine from '../engine.js';
import { getRainFlag } from '../weather.js';

const FORMALITY_LABELS = ['Casual', 'Smart casual', 'Business casual', 'Business', 'Formal'];
const SLOT_LABELS = { top: 'Top', bottom: 'Bottom', outer: 'Outer layer', shoes: 'Shoes' };

// Module-level session state — resets on reload, not persisted, since Today
// is meant to be re-decided each time you open the app.
let state = null;

export async function render(container) {
  const [items, combos, wearLog, settings] = await Promise.all([
    db.getAll('items'),
    db.getAll('combos'),
    db.getAll('wearLog'),
    db.getSettings(),
  ]);

  if (!state) {
    const rain = await getRainFlag(settings.location, settings, db.saveSettings);
    state = {
      formalityTarget: 3,
      rain: rain === null ? false : rain,
      rainIsManual: false,
      excludeIds: new Set(),
      current: null,
      baseComboId: null,
      swapped: false,
    };
    recomputeRecommendation(items, combos, settings);
  }

  container.innerHTML = renderShell();
  await hydrate(container, items, combos, wearLog, settings);
}

function recomputeRecommendation(items, combos, settings) {
  const pool = items.filter((i) => !state.excludeIds.has(i.id));
  const poolCombos = combos.filter((c) => !Object.values(c.itemIds).some((id) => id && state.excludeIds.has(id)));
  const target = { formality: state.formalityTarget, rain: state.rain };
  const result = engine.recommend(pool, poolCombos, target, settings, new Date());
  state.current = result.itemIds;
  state.baseComboId = result.comboId;
  state.swapped = false;
}

function renderShell() {
  return `
    <section class="screen today">
      <h1>Today</h1>
      <div class="controls">
        <div class="formality-row" id="formality-row"></div>
        <label class="rain-toggle">
          <input type="checkbox" id="rain-toggle" />
          <span>Rain expected</span>
        </label>
      </div>
      <div class="outfit" id="outfit"></div>
      <div class="actions">
        <button id="btn-reroll" class="btn secondary">Reroll</button>
        <button id="btn-wear" class="btn primary">Wear this</button>
      </div>
    </section>
  `;
}

async function hydrate(container, items, combos, wearLog, settings) {
  const itemById = new Map(items.map((i) => [i.id, i]));

  const formalityRow = container.querySelector('#formality-row');
  formalityRow.innerHTML = FORMALITY_LABELS.map(
    (label, i) =>
      `<button type="button" class="chip${i + 1 === state.formalityTarget ? ' active' : ''}" data-formality="${i + 1}">${label}</button>`
  ).join('');
  formalityRow.querySelectorAll('[data-formality]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.formalityTarget = Number(btn.dataset.formality);
      state.excludeIds.clear();
      recomputeRecommendation(items, combos, settings);
      render(container);
    });
  });

  const rainToggle = container.querySelector('#rain-toggle');
  rainToggle.checked = state.rain;
  rainToggle.addEventListener('change', () => {
    state.rain = rainToggle.checked;
    state.rainIsManual = true;
    state.excludeIds.clear();
    recomputeRecommendation(items, combos, settings);
    render(container);
  });

  const outfitEl = container.querySelector('#outfit');
  outfitEl.innerHTML = '';
  for (const slot of engine.SLOTS) {
    const itemId = state.current[slot];
    const item = itemId ? itemById.get(itemId) : null;
    const emptyLabel = engine.OPTIONAL_SLOTS.includes(slot) ? 'No layer' : 'None available';
    const card = document.createElement('div');
    card.className = 'slot-card';
    card.innerHTML = `
      <div class="slot-label">${SLOT_LABELS[slot]}</div>
      <div class="slot-photo" data-slot="${slot}">${item ? '' : `<span class="empty">${emptyLabel}</span>`}</div>
      <div class="slot-name">${item ? escapeHtml(item.name) : '—'}</div>
      <button type="button" class="btn small swap-btn" data-slot="${slot}">Swap</button>
    `;
    outfitEl.appendChild(card);

    if (item && item.photoBlobId) {
      db.getPhotoUrl(item.photoBlobId).then((url) => {
        const photoEl = card.querySelector('.slot-photo');
        if (url) photoEl.innerHTML = `<img src="${url}" alt="${escapeHtml(item.name)}" />`;
      });
    }
  }

  outfitEl.querySelectorAll('.swap-btn').forEach((btn) => {
    btn.addEventListener('click', () => openSwapPicker(container, btn.dataset.slot, items, settings));
  });

  container.querySelector('#btn-reroll').addEventListener('click', () => {
    for (const id of Object.values(state.current)) {
      if (id) state.excludeIds.add(id);
    }
    recomputeRecommendation(items, combos, settings);
    render(container);
  });

  container.querySelector('#btn-wear').addEventListener('click', () => handleWear(container, items, combos, wearLog, settings));
}

function openSwapPicker(container, slot, items, settings) {
  const target = { formality: state.formalityTarget, rain: state.rain };
  const options = engine.swapOptions(items, state.current, slot, target, settings, new Date());

  const existing = container.querySelector('.swap-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'swap-overlay';
  overlay.innerHTML = `
    <div class="swap-sheet">
      <h2>Swap ${SLOT_LABELS[slot]}</h2>
      <div class="swap-options">
        ${options
          .map((opt, i) =>
            opt.type === 'none'
              ? `<button type="button" class="swap-option" data-index="${i}">No layer</button>`
              : `<button type="button" class="swap-option" data-index="${i}">${escapeHtml(opt.item.name)}</button>`
          )
          .join('') || '<p class="empty-note">No compatible alternatives available.</p>'}
      </div>
      <button type="button" class="btn secondary" id="swap-cancel">Cancel</button>
    </div>
  `;
  container.appendChild(overlay);

  overlay.querySelector('#swap-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelectorAll('.swap-option').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const opt = options[Number(btn.dataset.index)];
      const outgoingId = state.current[slot];
      if (outgoingId) {
        let rejections = await db.getAll('rejections');
        rejections = engine.logRejection(rejections, {
          context: 'swap',
          slot,
          itemId: outgoingId,
          date: new Date().toISOString(),
        });
        await db.put('rejections', rejections[rejections.length - 1]);
      }
      state.current = { ...state.current, [slot]: opt.type === 'none' ? null : opt.item.id };
      state.swapped = true;
      overlay.remove();
      render(container);
    });
  });
}

async function handleWear(container, items, combos, wearLog, settings) {
  const date = new Date().toISOString();
  const wornIds = Object.values(state.current).filter(Boolean);
  const isUnmodifiedCombo = state.baseComboId && !state.swapped;

  const { items: updatedItems, wearLog: updatedLog } = engine.logWear(
    items,
    wearLog,
    {
      itemIds: wornIds,
      comboId: isUnmodifiedCombo ? state.baseComboId : null,
      date,
      formalityTarget: state.formalityTarget,
      rain: state.rain,
      oneOff: !isUnmodifiedCombo,
    },
    settings
  );

  await db.putAll('items', updatedItems);
  const newEntry = updatedLog[updatedLog.length - 1];
  await db.put('wearLog', newEntry);

  if (!isUnmodifiedCombo) {
    const wantsSave = window.confirm('Save this outfit as a combo for next time?');
    if (wantsSave) {
      const name = window.prompt('Name this combo:', '');
      if (name) {
        const { combo } = engine.saveCombo(combos, {
          name,
          itemIds: state.current,
          parentId: state.swapped ? state.baseComboId : null,
        });
        await db.put('combos', combo);
        await db.put('wearLog', { ...newEntry, comboId: combo.id, oneOff: false });
      }
    }
  }

  state = null; // force a fresh recommendation next time Today is opened
  window.location.hash = '#/today';
  await render(container);
  window.alert('Logged. See you tomorrow!');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function resetState() {
  state = null;
}
