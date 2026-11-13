// Small DOM helpers. User content always goes through textContent.
const $ = sel => document.querySelector(sel);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function relTime(ms) {
  const d = Date.now() - ms;
  const min = Math.round(d / 60000);
  if (min < 1) return 'teraz';
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  const days = Math.round(h / 24);
  if (days === 1) return 'wczoraj';
  if (days < 7) return `${days} dni`;
  return new Date(ms).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
