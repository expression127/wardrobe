import * as db from '../db.js';

const CATEGORIES = ['top', 'bottom', 'outer', 'shoes', 'accessory'];

export async function render(container) {
  const items = await db.getAll('items');
  const visible = items.filter((i) => !i.archived);

  container.innerHTML = `
    <section class="screen wardrobe">
      <h1>Wardrobe</h1>
      <div class="grid" id="wardrobe-grid"></div>
      <button type="button" class="fab" id="btn-add">+</button>
    </section>
  `;

  const grid = container.querySelector('#wardrobe-grid');
  for (const item of visible) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'wardrobe-card';
    card.innerHTML = `
      <div class="wardrobe-photo"></div>
      <div class="wardrobe-name">${escapeHtml(item.name)}</div>
      <div class="wardrobe-meta">${escapeHtml(item.category)} · F${item.formality}${item.rain_ok ? ' · ☔ ok' : ''}${item.dirty ? ' · dirty' : ''}</div>
    `;
    card.addEventListener('click', () => openForm(container, item));
    grid.appendChild(card);

    if (item.photoBlobId) {
      db.getPhotoUrl(item.photoBlobId).then((url) => {
        if (url) card.querySelector('.wardrobe-photo').innerHTML = `<img src="${url}" alt="${escapeHtml(item.name)}" />`;
      });
    }
  }

  container.querySelector('#btn-add').addEventListener('click', () => openForm(container, null));
}

function openForm(container, item) {
  const isEdit = !!item;
  const overlay = document.createElement('div');
  overlay.className = 'swap-overlay';
  overlay.innerHTML = `
    <div class="swap-sheet form-sheet">
      <h2>${isEdit ? 'Edit item' : 'Add item'}</h2>
      <form id="item-form">
        <label>Photo
          <input type="file" accept="image/*" capture="environment" id="f-photo" ${isEdit ? '' : 'required'} />
        </label>
        <label>Name
          <input type="text" id="f-name" required value="${isEdit ? escapeHtml(item.name) : ''}" />
        </label>
        <label>Category
          <select id="f-category">
            ${CATEGORIES.map((c) => `<option value="${c}" ${isEdit && item.category === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </label>
        <label>Formality (1-5)
          <input type="number" id="f-formality" min="1" max="5" required value="${isEdit ? item.formality : 3}" />
        </label>
        <label class="checkbox-row">
          <input type="checkbox" id="f-rain-ok" ${isEdit && item.rain_ok ? 'checked' : ''} />
          Rain-ok
        </label>
        <label>Tags &amp; colours (comma separated)
          <input type="text" id="f-tags" value="${isEdit ? escapeHtml([...(item.colors || []), ...(item.tags || [])].join(', ')) : ''}" />
        </label>
        <div class="form-actions">
          <button type="button" class="btn secondary" id="f-cancel">Cancel</button>
          ${isEdit ? '<button type="button" class="btn danger" id="f-archive">Archive</button>' : ''}
          <button type="submit" class="btn primary">Save</button>
        </div>
      </form>
    </div>
  `;
  container.appendChild(overlay);

  overlay.querySelector('#f-cancel').addEventListener('click', () => overlay.remove());
  if (isEdit) {
    overlay.querySelector('#f-archive').addEventListener('click', async () => {
      if (!window.confirm(`Archive "${item.name}"? It stays in history but won't be recommended again.`)) return;
      await db.put('items', { ...item, archived: true });
      overlay.remove();
      render(container);
    });
  }

  overlay.querySelector('#item-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = overlay.querySelector('#f-name').value.trim();
    const category = overlay.querySelector('#f-category').value;
    const formality = Number(overlay.querySelector('#f-formality').value);
    const rain_ok = overlay.querySelector('#f-rain-ok').checked;
    const tagsRaw = overlay.querySelector('#f-tags').value;
    const tags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const photoFile = overlay.querySelector('#f-photo').files[0];

    let photoBlobId = isEdit ? item.photoBlobId : null;
    if (photoFile) {
      if (isEdit && item.photoBlobId) await db.deletePhoto(item.photoBlobId);
      photoBlobId = await db.storePhoto(photoFile);
    }

    const record = {
      id: isEdit ? item.id : 'item_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      name,
      category,
      colors: [],
      formality,
      rain_ok,
      tags,
      photoBlobId,
      archived: isEdit ? item.archived : false,
      dirty: isEdit ? item.dirty : false,
      lastWorn: isEdit ? item.lastWorn : null,
      createdAt: isEdit ? item.createdAt : new Date().toISOString(),
    };
    await db.put('items', record);
    overlay.remove();
    render(container);
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
