// Open-Meteo lookup (no API key needed). Caches the rain flag for 30 minutes
// in the settings record so repeated Today-screen loads don't refetch, and
// fails gracefully (returns null) when offline or the request errors out.

const CACHE_MS = 30 * 60 * 1000;
const RAIN_PROBABILITY_THRESHOLD = 50; // percent
const FETCH_TIMEOUT_MS = 5000;

export async function getRainFlag(location, settings, saveSettings) {
  const cache = settings.weatherCache;
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS && cache.lat === location.lat && cache.lon === location.lon) {
    return cache.rain;
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}&hourly=precipitation_probability&forecast_days=1&timezone=auto`;
    // A hung request (captive portal, dropped packets, sandboxed network)
    // must never block the Today screen indefinitely, so bound it explicitly
    // instead of relying on fetch's own (often very long) default timeout.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
    const data = await res.json();

    const probs = data?.hourly?.precipitation_probability ?? [];
    const times = data?.hourly?.time ?? [];
    const nowHourIndex = findCurrentHourIndex(times);
    const relevant = nowHourIndex >= 0 ? probs.slice(nowHourIndex, nowHourIndex + 6) : probs.slice(0, 6);
    const maxProb = relevant.length ? Math.max(...relevant) : 0;
    const rain = maxProb >= RAIN_PROBABILITY_THRESHOLD;

    const newSettings = {
      ...settings,
      weatherCache: { fetchedAt: Date.now(), lat: location.lat, lon: location.lon, rain },
    };
    await saveSettings(newSettings);
    return rain;
  } catch (err) {
    // Offline or request failed — fall back to the last known cached value if
    // any exists, otherwise let the caller decide (null means "unknown").
    return cache ? cache.rain : null;
  }
}

function findCurrentHourIndex(times) {
  const now = new Date();
  for (let i = 0; i < times.length; i++) {
    const t = new Date(times[i]);
    if (t.getTime() >= now.getTime()) return i;
  }
  return -1;
}
