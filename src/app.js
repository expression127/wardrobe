import { seedIfEmpty } from './seed.js';
import * as today from './ui/today.js';
import * as wardrobe from './ui/wardrobe.js';
import * as settings from './ui/settings.js';
import * as history from './ui/history.js';

const ROUTES = {
  '#/today': today,
  '#/wardrobe': wardrobe,
  '#/settings': settings,
  '#/history': history,
};

const appEl = document.getElementById('app');
const navLinks = document.querySelectorAll('.nav-link');

async function route() {
  const hash = window.location.hash || '#/today';
  const screen = ROUTES[hash] || today;
  navLinks.forEach((link) => link.classList.toggle('active', link.getAttribute('href') === hash));
  await screen.render(appEl);
}

window.addEventListener('hashchange', route);

async function main() {
  // If running from file:// with no IndexedDB support warning path, this will
  // throw — acceptable for v1, the README calls out serving over http(s).
  await seedIfEmpty();
  if (!window.location.hash) window.location.hash = '#/today';
  await route();

  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js', { scope: './' });
    } catch (err) {
      console.warn('Service worker registration failed', err);
    }
  }
}

main();
