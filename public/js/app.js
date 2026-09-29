import { api, el, formatDate, formatPrice, STATUS_LABEL, ApiError } from './api.js';

const $ = (sel) => document.querySelector(sel);
const dialog = $('#register-dialog');
const form = $('#register-form');
let currentEvent = null;

// ---------- Liste des événements ----------
async function loadEvents() {
  const status = $('#events-status');
  const grid = $('#events');
  try {
    const events = await api('/events?upcoming=true');
    grid.replaceChildren(...events.map(eventCard));
    status.textContent = events.length ? '' : 'Aucun événement à venir pour le moment. Revenez vite !';
  } catch {
    status.textContent = 'Impossible de charger les événements. Réessayez dans un instant.';
  }
}

function eventCard(ev) {
  const pct = Math.min(100, Math.round((ev.confirmed / ev.capacity) * 100));
  const full = ev.remaining === 0;
  return el('article', { class: 'card' },
    el('div', { class: 'date' }, formatDate(ev.startsAt)),
    el('h3', {}, ev.title),
    el('div', { class: 'place' }, `${ev.venue} · ${ev.city}`),
    el('p', { class: 'desc' }, ev.description),
    el('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 },
      el('i', { style: `width:${pct}%` })),
    el('div', { class: 'places' },
      full ? el('span', { class: 'badge full' }, "Complet — liste d'attente ouverte") : `${ev.remaining} place(s) restante(s) sur ${ev.capacity}`),
    el('div', { class: 'meta' },
      el('span', { class: 'price' }, formatPrice(ev.priceEur)),
      el('button', { class: 'btn', onclick: () => openRegister(ev) }, full ? "Rejoindre la liste d'attente" : 'Je réserve')));
}

// ---------- Formulaire d'inscription ----------
function openRegister(ev) {
  currentEvent = ev;
  form.reset();
  form.classList.remove('hidden');
  $('#register-done').classList.add('hidden');
  $('#register-alert').replaceChildren();
  form.querySelectorAll('.field-error').forEach((n) => n.remove());
  $('#register-title').textContent = ev.title;
  $('#register-sub').textContent = `${formatDate(ev.startsAt)} — ${ev.venue}, ${ev.city}`;
  const code = new URLSearchParams(location.search).get('ref'); // lien de parrainage ?ref=CODE
  if (code) form.partnerCode.value = code;
  dialog.showModal();
  form.firstName.focus();
}

$('#register-cancel').addEventListener('click', () => dialog.close());

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  form.querySelectorAll('.field-error').forEach((n) => n.remove());
  $('#register-alert').replaceChildren();
  const btn = $('#register-submit');
  btn.disabled = true;
  const payload = {
    firstName: form.firstName.value,
    lastName: form.lastName.value,
    email: form.email.value,
    phone: form.phone.value,
    source: form.source.value,
    partnerCode: form.partnerCode.value,
    consent: form.consent.checked,
  };
  try {
    const reg = await api(`/events/${currentEvent.id}/registrations`, { method: 'POST', body: payload });
    showConfirmation(reg);
    loadEvents();
  } catch (err) {
    if (err instanceof ApiError && err.details) {
      for (const [field, msg] of Object.entries(err.details)) {
        const input = form.elements[field];
        const label = input?.closest('label');
        if (label) label.append(el('span', { class: 'field-error' }, msg));
      }
    }
    $('#register-alert').replaceChildren(el('div', { class: 'alert error' }, err.message));
  } finally {
    btn.disabled = false;
  }
});

function showConfirmation(reg) {
  form.classList.add('hidden');
  const waiting = reg.status === 'waitlist';
  $('#register-done').replaceChildren(
    el('div', { class: 'ticket' },
      el('h2', {}, waiting ? "Vous êtes sur liste d'attente" : 'Inscription confirmée 🎉'),
      el('p', { class: 'muted' }, waiting
        ? 'Dès qu’une place se libère, votre billet passe automatiquement en « confirmé ». Conservez ce code :'
        : 'Présentez ce code à l’entrée :'),
      el('div', { class: 'code' }, reg.ticketCode),
      el('div', { class: 'actions', style: 'justify-content:center' },
        el('button', { class: 'btn', onclick: () => dialog.close() }, 'Fermer'))));
  $('#register-done').classList.remove('hidden');
}

// ---------- Recherche / annulation de billet ----------
$('#ticket-form').addEventListener('submit', (e) => {
  e.preventDefault();
  showTicket($('#ticket-code').value.trim());
});

async function showTicket(code) {
  const out = $('#ticket-result');
  if (!code) return;
  try {
    const t = await api(`/tickets/${encodeURIComponent(code)}`);
    const cancelBtn = t.status !== 'cancelled' && !t.checkedInAt
      ? el('button', {
          class: 'btn danger small',
          onclick: async () => {
            if (!confirm('Annuler définitivement cette inscription ?')) return;
            try {
              await api(`/tickets/${encodeURIComponent(t.ticketCode)}`, { method: 'DELETE' });
              showTicket(t.ticketCode);
              loadEvents();
            } catch (err) {
              out.prepend(el('div', { class: 'alert error' }, err.message));
            }
          },
        }, 'Annuler mon inscription')
      : null;
    out.replaceChildren(el('div', { class: 'card', style: 'margin-top:16px' },
      el('div', { class: 'date' }, formatDate(t.event.startsAt)),
      el('h3', {}, t.event.title),
      el('div', {}, `${t.firstName} ${t.lastName} — `, el('span', { class: `badge ${t.status}` }, STATUS_LABEL[t.status])),
      t.waitlistPosition ? el('div', { class: 'muted' }, `Position dans la liste d'attente : ${t.waitlistPosition}`) : null,
      t.checkedInAt ? el('div', { class: 'muted' }, 'Entrée validée ✔') : null,
      el('div', { class: 'meta' }, el('code', {}, t.ticketCode), cancelBtn)));
  } catch (err) {
    out.replaceChildren(el('div', { class: 'alert error' }, err.message));
  }
}

loadEvents();
