// Seed data for first run / manual testing. Only runs when the items store is
// empty, so it never clobbers real data. Photos are generated as simple
// colored placeholder blobs (canvas) since we have no real camera photos here.

import * as db from './db.js';

const PLACEHOLDERS = {
  'White Tee': '#f4f4f2',
  'Blue Oxford Shirt': '#3b5b92',
  'Chinos': '#c2a878',
  'Dark Jeans': '#2b3340',
  'Light Jacket': '#6b7b8c',
  Sneakers: '#d94f4f',
  Loafers: '#5a3d2b',
};

async function placeholderPhotoId(label, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 400;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 400, 400);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.font = 'bold 42px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 200, 200, 360);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  return db.storePhoto(blob);
}

export async function seedIfEmpty() {
  const existing = await db.getAll('items');
  if (existing.length > 0) return false;

  const defs = [
    { id: 'top1', name: 'White Tee', category: 'top', colors: ['white'], formality: 2, rain_ok: true, tags: ['basic'] },
    { id: 'top2', name: 'Blue Oxford Shirt', category: 'top', colors: ['blue'], formality: 3, rain_ok: true, tags: ['work'] },
    { id: 'bottom1', name: 'Chinos', category: 'bottom', colors: ['tan'], formality: 3, rain_ok: true, tags: ['work'] },
    { id: 'bottom2', name: 'Dark Jeans', category: 'bottom', colors: ['navy'], formality: 2, rain_ok: true, tags: ['casual'] },
    { id: 'outer1', name: 'Light Jacket', category: 'outer', colors: ['grey'], formality: 3, rain_ok: true, tags: ['layer'] },
    { id: 'shoes1', name: 'Sneakers', category: 'shoes', colors: ['red'], formality: 2, rain_ok: true, tags: ['casual'] },
    { id: 'shoes2', name: 'Loafers', category: 'shoes', colors: ['brown'], formality: 4, rain_ok: false, tags: ['formal'] },
  ];

  for (const def of defs) {
    const photoId = await placeholderPhotoId(def.name, PLACEHOLDERS[def.name] || '#888');
    await db.put('items', {
      id: def.id,
      name: def.name,
      category: def.category,
      colors: def.colors,
      formality: def.formality,
      rain_ok: def.rain_ok,
      tags: def.tags,
      photoBlobId: photoId,
      archived: false,
      dirty: false,
      lastWorn: null,
      createdAt: new Date().toISOString(),
    });
  }

  await db.put('combos', {
    id: 'combo1',
    name: 'Smart Casual Default',
    itemIds: { top: 'top2', bottom: 'bottom1', outer: null, shoes: 'shoes1' },
    parentId: null,
    archived: false,
    createdAt: new Date().toISOString(),
  });

  return true;
}
