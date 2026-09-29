'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');

const TOKEN = 'test-admin-token-123';
let server;
let base;
let db;

before(async () => {
  db = openDatabase(':memory:');
  server = createApp({ db, adminToken: TOKEN }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => {
  server.close();
  db.close();
});

async function call(method, url, body, { admin = false } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (admin) headers['x-admin-token'] = TOKEN;
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}

const future = () => new Date(Date.now() + 7 * 86400000).toISOString();
const person = (i, extra = {}) => ({
  firstName: 'Test', lastName: `Personne${i}`, email: `p${i}@example.com`, consent: true, ...extra,
});

async function createEvent(extra = {}) {
  const res = await call('POST', '/admin/events',
    { title: 'Soirée test', venue: 'Salle', city: 'Bordeaux', startsAt: future(), capacity: 2, priceEur: 10, ...extra },
    { admin: true });
  assert.equal(res.status, 201);
  return res.body;
}

test("les routes d'administration exigent le jeton", async () => {
  assert.equal((await call('GET', '/admin/stats')).status, 401);
  assert.equal((await call('POST', '/admin/events', {})).status, 401);
});

test("validation des données d'inscription", async () => {
  const ev = await createEvent();
  const res = await call('POST', `/events/${ev.id}/registrations`, { firstName: '', email: 'pas-un-email' });
  assert.equal(res.status, 400);
  assert.ok(res.body.details.email);
  assert.ok(res.body.details.consent);
});

test("capacité, liste d'attente et promotion automatique après annulation", async () => {
  const ev = await createEvent({ capacity: 2 });
  const a = await call('POST', `/events/${ev.id}/registrations`, person(1));
  const b = await call('POST', `/events/${ev.id}/registrations`, person(2));
  const c = await call('POST', `/events/${ev.id}/registrations`, person(3));
  assert.equal(a.body.status, 'confirmed');
  assert.equal(b.body.status, 'confirmed');
  assert.equal(c.body.status, 'waitlist');

  const ticket = await call('GET', `/tickets/${c.body.ticketCode}`);
  assert.equal(ticket.body.waitlistPosition, 1);

  const cancel = await call('DELETE', `/tickets/${a.body.ticketCode}`);
  assert.deepEqual(cancel.body.promoted, [c.body.ticketCode]);
  assert.equal((await call('GET', `/tickets/${c.body.ticketCode}`)).body.status, 'confirmed');

  const event = await call('GET', `/events/${ev.id}`);
  assert.equal(event.body.remaining, 0);
  assert.equal(event.body.waitlist, 0);
});

test('une adresse e-mail ne peut pas s’inscrire deux fois au même événement', async () => {
  const ev = await createEvent({ capacity: 10 });
  assert.equal((await call('POST', `/events/${ev.id}/registrations`, person(9))).status, 201);
  const dup = await call('POST', `/events/${ev.id}/registrations`, person(9, { email: 'P9@EXAMPLE.COM' }));
  assert.equal(dup.status, 409);
});

test('code partenaire influenceur : attribution et statistiques', async () => {
  const p = await call('POST', '/admin/partners', { name: 'Créatrice TikTok', platform: 'tiktok', code: 'tiktok10' }, { admin: true });
  assert.equal(p.status, 201);
  assert.equal(p.body.code, 'TIKTOK10');

  const ev = await createEvent({ capacity: 10 });
  const r = await call('POST', `/events/${ev.id}/registrations`, person(20, { partnerCode: 'tiktok10' }));
  assert.equal(r.body.partner.code, 'TIKTOK10');
  assert.equal(r.body.source, 'influenceur');

  const bad = await call('POST', `/events/${ev.id}/registrations`, person(21, { partnerCode: 'INCONNU' }));
  assert.equal(bad.status, 400);

  const stats = await call('GET', '/admin/stats', null, { admin: true });
  assert.equal(stats.body.partners.find((x) => x.code === 'TIKTOK10').registrations, 1);
});

test("contrôle à l'entrée : un billet ne peut être scanné qu'une fois", async () => {
  const ev = await createEvent({ capacity: 5 });
  const r = await call('POST', `/events/${ev.id}/registrations`, person(30));
  const first = await call('POST', `/admin/tickets/${r.body.ticketCode}/check-in`, null, { admin: true });
  assert.equal(first.status, 200);
  assert.ok(first.body.checkedInAt);
  const second = await call('POST', `/admin/tickets/${r.body.ticketCode}/check-in`, null, { admin: true });
  assert.equal(second.status, 409);
});

test('la capacité ne peut pas descendre sous le nombre de confirmés', async () => {
  const ev = await createEvent({ capacity: 3 });
  await call('POST', `/events/${ev.id}/registrations`, person(40));
  await call('POST', `/events/${ev.id}/registrations`, person(41));
  const res = await call('PATCH', `/admin/events/${ev.id}`, { capacity: 1 }, { admin: true });
  assert.equal(res.status, 409);
});

test('export CSV protégé contre les injections de formules', async () => {
  const ev = await createEvent({ capacity: 5 });
  await call('POST', `/events/${ev.id}/registrations`, person(50, { firstName: '=HYPERLINK("x")' }));
  const res = await call('GET', `/admin/events/${ev.id}/registrations.csv`, null, { admin: true });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.body, /"'=HYPERLINK\(""x""\)"/);
});

test('les événements non publiés ne sont pas visibles publiquement', async () => {
  const ev = await createEvent({ published: false });
  assert.equal((await call('GET', `/events/${ev.id}`)).status, 404);
  const list = await call('GET', '/events');
  assert.ok(!list.body.some((e) => e.id === ev.id));
});
