import { api, el, formatPrice, STATUS_LABEL, SOURCE_LABEL } from './api.js';

const $ = (sel) => document.querySelector(sel);
const KEY = 'je-admin-token';
let token = sessionStorage.getItem(KEY) || '';
let selectedEvent = null;

const call = (path, opts = {}) => api(path, { ...opts, token });
const alertBox = (target, type, msg) => $(target).replaceChildren(el('div', { class: `alert ${type}` }, msg));
const shortDate = (iso) =>
  new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// ---------- Connexion ----------
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  token = $('#token').value.trim();
  try {
    await call('/admin/stats');
    sessionStorage.setItem(KEY, token);
    showDashboard();
  } catch (err) {
    alertBox('#login-alert', 'error', err.status === 401 ? 'Jeton invalide.' : err.message);
  }
});

$('#logout').addEventListener('click', (e) => {
  e.preventDefault();
  sessionStorage.removeItem(KEY);
  location.reload();
});

async function showDashboard() {
  $('#login').classList.add('hidden');
  $('#dashboard').classList.remove('hidden');
  $('#logout').classList.remove('hidden');
  await refresh();
}

// ---------- Tableau de bord ----------
async function refresh() {
  const s = await call('/admin/stats');
  const revenue = s.events.reduce((sum, e) => sum + e.revenueEur, 0);
  const kpi = (value, label) => el('div', { class: 'kpi' }, el('b', {}, value), el('span', {}, label));
  $('#kpis').replaceChildren(
    kpi(s.totals.confirmed, 'inscriptions confirmées'),
    kpi(s.totals.waitlist, "en liste d'attente"),
    kpi(s.totals.checkedIn, 'entrées validées'),
    kpi(formatPrice(revenue), "chiffre d'affaires estimé"),
  );

  $('#events-body').replaceChildren(...s.events.map((e) =>
    el('tr', { class: selectedEvent === e.id ? 'selected' : '' },
      el('td', {}, e.title),
      el('td', {}, shortDate(e.startsAt)),
      el('td', { class: 'num' }, `${e.confirmed} / ${e.capacity}`),
      el('td', { class: 'num' }, e.waitlist),
      el('td', { class: 'num' }, `${e.fillRate} %`),
      el('td', { class: 'num' }, e.checkedIn),
      el('td', { class: 'num' }, formatPrice(e.revenueEur)),
      el('td', {}, el('button', { class: 'btn secondary small', onclick: () => openRegistrations(e) }, 'Inscrits')))));

  const max = Math.max(1, ...s.bySource.map((x) => x.count));
  $('#sources').replaceChildren(...(s.bySource.length ? s.bySource.map((x) =>
    el('div', { class: 'hbar' },
      el('span', {}, SOURCE_LABEL[x.source] || x.source),
      el('div', { class: 'bar' }, el('i', { style: `width:${(x.count / max) * 100}%` })),
      el('b', { class: 'num' }, x.count))) : [el('p', { class: 'muted' }, 'Aucune inscription pour le moment.')]));

  $('#partners-body').replaceChildren(...s.partners.map((p) =>
    el('tr', {}, el('td', {}, p.name), el('td', {}, p.platform), el('td', {}, el('code', {}, p.code)),
      el('td', { class: 'num' }, p.registrations))));

  if (selectedEvent) {
    const ev = s.events.find((e) => e.id === selectedEvent);
    if (ev) await openRegistrations(ev, { scroll: false });
  }
}

// ---------- Inscriptions d'un événement + contrôle d'entrée ----------
async function openRegistrations(ev, { scroll = true } = {}) {
  selectedEvent = ev.id;
  const regs = await call(`/admin/events/${ev.id}/registrations`);
  $('#regs-panel').classList.remove('hidden');
  $('#regs-title').textContent = `Inscriptions — ${ev.title} (${regs.length})`;
  $('#regs-body').replaceChildren(...regs.map((r) =>
    el('tr', {},
      el('td', {}, el('code', {}, r.ticketCode)),
      el('td', {}, `${r.firstName} ${r.lastName}`),
      el('td', {}, r.email),
      el('td', {}, r.partner ? `${SOURCE_LABEL[r.source]} (${r.partner.code})` : SOURCE_LABEL[r.source] || r.source),
      el('td', {}, el('span', { class: `badge ${r.status}` }, STATUS_LABEL[r.status])),
      el('td', {}, r.checkedInAt ? '✔' : r.status === 'confirmed'
        ? el('button', { class: 'btn secondary small', onclick: () => checkIn(r.ticketCode) }, 'Valider') : ''))));
  if (scroll) $('#regs-panel').scrollIntoView({ behavior: 'smooth' });
}

async function checkIn(code) {
  try {
    const r = await call(`/admin/tickets/${encodeURIComponent(code)}/check-in`, { method: 'POST' });
    alertBox('#checkin-alert', 'success', `Entrée validée : ${r.firstName} ${r.lastName}`);
    $('#checkin-code').value = '';
    await refresh();
  } catch (err) {
    alertBox('#checkin-alert', 'error', err.message);
  }
}

$('#checkin-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('#checkin-code').value.trim();
  if (code) checkIn(code);
});

$('#export-csv').addEventListener('click', async () => {
  if (!selectedEvent) return;
  const blob = await call(`/admin/events/${selectedEvent}/registrations.csv`);
  const a = el('a', { href: URL.createObjectURL(blob), download: `inscriptions-evenement-${selectedEvent}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------- Formulaires de création ----------
$('#partner-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await call('/admin/partners', { method: 'POST', body: { name: f.name.value, platform: f.platform.value, code: f.code.value } });
    f.reset();
    $('#partner-alert').replaceChildren();
    await refresh();
  } catch (err) {
    alertBox('#partner-alert', 'error', Object.values(err.details || {})[0] || err.message);
  }
});

$('#event-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await call('/admin/events', {
      method: 'POST',
      body: {
        title: f.title.value, description: f.description.value, venue: f.venue.value, city: f.city.value,
        startsAt: new Date(f.startsAt.value).toISOString(), capacity: Number(f.capacity.value),
        priceEur: Number(f.priceEur.value || 0), published: f.published.checked,
      },
    });
    f.reset();
    alertBox('#event-alert', 'success', 'Événement créé.');
    await refresh();
  } catch (err) {
    alertBox('#event-alert', 'error', Object.values(err.details || {})[0] || err.message);
  }
});

if (token) {
  call('/admin/stats').then(showDashboard).catch(() => sessionStorage.removeItem(KEY));
}
