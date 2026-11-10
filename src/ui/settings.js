import * as db from '../db.js';
import * as engine from '../engine.js';
import { resetState as resetTodayState } from './today.js';

export async function render(container) {
  const settings = await db.getSettings();
  const items = await db.getAll('items');
  const dirtyCount = items.filter((i) => i.dirty).length;

  container.innerHTML = `
    <section class="screen settings">
      <h1>Settings</h1>

      <fieldset>
        <legend>Laundry mode</legend>
        <label class="radio-row"><input type="radio" name="laundry" value="off" ${settings.laundryMode === 'off' ? 'checked' : ''}/> Off — everything is always available</label>
        <label class="radio-row"><input type="radio" name="laundry" value="auto" ${settings.laundryMode === 'auto' ? 'checked' : ''}/> Auto — items rest for N days after wear</label>
        <label class="radio-row"><input type="radio" name="laundry" value="full" ${settings.laundryMode === 'full' ? 'checked' : ''}/> Full — worn items stay dirty until you wash them</label>
      </fieldset>

      <label id="auto-days-row" class="${settings.laundryMode === 'auto' ? '' : 'hidden'}">
        Auto-reset days
        <input type="number" id="auto-days" min="1" value="${settings.autoResetDays}" />
      </label>

      <div id="washed-row" class="${settings.laundryMode === 'full' ? '' : 'hidden'}">
        <button type="button" class="btn secondary" id="btn-washed">Washed (${dirtyCount} dirty item${dirtyCount === 1 ? '' : 's'})</button>
      </div>

      <fieldset>
        <legend>Weather location</legend>
        <label>Label <input type="text" id="loc-label" value="${escapeHtml(settings.location.label)}" /></label>
        <label>Latitude <input type="number" step="0.01" id="loc-lat" value="${settings.location.lat}" /></label>
        <label>Longitude <input type="number" step="0.01" id="loc-lon" value="${settings.location.lon}" /></label>
      </fieldset>

      <button type="button" class="btn primary" id="btn-save">Save settings</button>

      <hr />

      <fieldset>
        <legend>Data</legend>
        <button type="button" class="btn secondary" id="btn-export">Export all data (JSON)</button>
        <label class="btn secondary file-btn">
          Import from JSON
          <input type="file" accept="application/json" id="btn-import" hidden />
        </label>
        <button type="button" class="btn danger" id="btn-wipe">Wipe all data</button>
      </fieldset>
    </section>
  `;

  const laundryRadios = container.querySelectorAll('input[name="laundry"]');
  laundryRadios.forEach((r) =>
    r.addEventListener('change', () => {
      container.querySelector('#auto-days-row').classList.toggle('hidden', r.value !== 'auto' || !r.checked);
      if (r.checked) {
        container.querySelector('#auto-days-row').classList.toggle('hidden', r.value !== 'auto');
        container.querySelector('#washed-row').classList.toggle('hidden', r.value !== 'full');
      }
    })
  );

  container.querySelector('#btn-washed').addEventListener('click', async () => {
    const dirtyIds = items.filter((i) => i.dirty).map((i) => i.id);
    const updated = engine.markClean(items, dirtyIds);
    await db.putAll('items', updated);
    render(container);
  });

  container.querySelector('#btn-save').addEventListener('click', async () => {
    const laundryMode = container.querySelector('input[name="laundry"]:checked').value;
    const autoResetDays = Number(container.querySelector('#auto-days').value) || 1;
    const location = {
      label: container.querySelector('#loc-label').value.trim() || 'Custom',
      lat: Number(container.querySelector('#loc-lat').value),
      lon: Number(container.querySelector('#loc-lon').value),
    };
    const next = { ...settings, laundryMode, autoResetDays, location, weatherCache: null };
    await db.saveSettings(next);
    resetTodayState();
    window.alert('Settings saved.');
    render(container);
  });

  container.querySelector('#btn-export').addEventListener('click', async () => {
    const data = await db.exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wardrobe-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  container.querySelector('#btn-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!window.confirm('Importing will replace all current items, combos, history and settings. Continue?')) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await db.importAllData(data);
      resetTodayState();
      window.alert('Import complete.');
      render(container);
    } catch (err) {
      window.alert('Import failed: ' + err.message);
    }
  });

  container.querySelector('#btn-wipe').addEventListener('click', async () => {
    if (!window.confirm('This permanently deletes every item, photo, combo and history entry. This cannot be undone. Continue?')) return;
    if (!window.confirm('Are you absolutely sure? Consider exporting first.')) return;
    await db.wipeAllData();
    resetTodayState();
    window.alert('All data wiped.');
    render(container);
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
