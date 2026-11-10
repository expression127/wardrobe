import * as db from '../db.js';

export async function render(container) {
  const [wearLog, items, combos] = await Promise.all([db.getAll('wearLog'), db.getAll('items'), db.getAll('combos')]);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const comboById = new Map(combos.map((c) => [c.id, c]));

  const sorted = [...wearLog].sort((a, b) => (a.date < b.date ? 1 : -1));

  container.innerHTML = `
    <section class="screen history">
      <h1>History</h1>
      <div class="history-list">
        ${
          sorted.length === 0
            ? '<p class="empty-note">Nothing logged yet.</p>'
            : sorted
                .map((entry) => {
                  const names = entry.itemIds
                    .map((id) => itemById.get(id)?.name || '(removed item)')
                    .join(', ');
                  const combo = entry.comboId ? comboById.get(entry.comboId) : null;
                  const dateLabel = new Date(entry.date).toLocaleDateString(undefined, {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  });
                  return `
                    <div class="history-entry">
                      <div class="history-date">${dateLabel}</div>
                      <div class="history-items">${escapeHtml(names)}</div>
                      <div class="history-meta">
                        F${entry.formalityTarget}${entry.rain ? ' · ☔' : ''}
                        ${combo ? ` · ${escapeHtml(combo.name)}` : entry.oneOff ? ' · one-off' : ''}
                      </div>
                    </div>
                  `;
                })
                .join('')
        }
      </div>
    </section>
  `;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
