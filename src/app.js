'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { createService } = require('./service');
const { HttpError, validateRegistration, validateEvent, validatePartner } = require('./validation');

function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    // Échappement CSV + neutralisation des injections de formules Excel
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const header = columns.map((c) => c.label).join(';');
  const lines = rows.map((r) => columns.map((c) => esc(c.get(r))).join(';'));
  return '﻿' + [header, ...lines].join('\r\n'); // BOM pour une ouverture correcte dans Excel
}

function createApp({ db, adminToken }) {
  if (!adminToken) throw new Error('adminToken requis');
  const service = createService(db);
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '50kb' }));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  const tokenBuf = Buffer.from(adminToken);
  function requireAdmin(req, _res, next) {
    const given = Buffer.from(String(req.get('x-admin-token') || ''));
    const ok = given.length === tokenBuf.length && crypto.timingSafeEqual(given, tokenBuf);
    next(ok ? undefined : new HttpError(401, 'Accès administrateur requis'));
  }

  const api = express.Router();

  // ---------- Public ----------
  api.get('/health', (_req, res) => res.json({ status: 'ok' }));

  api.get('/events', (req, res) => {
    res.json(service.listEvents({ upcomingOnly: req.query.upcoming === 'true' }));
  });

  api.get('/events/:id', (req, res) => {
    res.json(service.getEvent(req.params.id, { publicOnly: true }));
  });

  api.post('/events/:id/registrations', (req, res) => {
    const reg = service.register(req.params.id, validateRegistration(req.body));
    res.status(201).json(reg);
  });

  api.get('/tickets/:code', (req, res) => res.json(service.getTicket(req.params.code)));
  api.delete('/tickets/:code', (req, res) => res.json(service.cancel(req.params.code)));

  // ---------- Administration ----------
  const admin = express.Router();
  admin.use(requireAdmin);

  admin.get('/events', (_req, res) => res.json(service.listEvents({ includeUnpublished: true })));
  admin.post('/events', (req, res) => res.status(201).json(service.createEvent(validateEvent(req.body))));
  admin.patch('/events/:id', (req, res) =>
    res.json(service.updateEvent(req.params.id, validateEvent(req.body, { partial: true })))
  );
  admin.delete('/events/:id', (req, res) => {
    service.deleteEvent(req.params.id);
    res.status(204).end();
  });

  admin.get('/events/:id/registrations', (req, res) => {
    const status = ['confirmed', 'waitlist', 'cancelled'].includes(req.query.status) ? req.query.status : undefined;
    res.json(service.listRegistrations(req.params.id, { status }));
  });

  admin.get('/events/:id/registrations.csv', (req, res) => {
    const event = service.getEvent(req.params.id);
    const rows = service.listRegistrations(req.params.id);
    const csv = toCsv(rows, [
      { label: 'Billet', get: (r) => r.ticketCode },
      { label: 'Prénom', get: (r) => r.firstName },
      { label: 'Nom', get: (r) => r.lastName },
      { label: 'E-mail', get: (r) => r.email },
      { label: 'Téléphone', get: (r) => r.phone },
      { label: 'Statut', get: (r) => r.status },
      { label: 'Source', get: (r) => r.source },
      { label: 'Partenaire', get: (r) => r.partner?.code ?? '' },
      { label: 'Inscrit le', get: (r) => r.createdAt },
      { label: 'Entrée scannée', get: (r) => r.checkedInAt ?? '' },
    ]);
    const slug = event.title.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="inscriptions-${slug || event.id}.csv"`);
    res.send(csv);
  });

  admin.post('/tickets/:code/check-in', (req, res) => res.json(service.checkIn(req.params.code)));

  admin.get('/partners', (_req, res) => res.json(service.listPartners()));
  admin.post('/partners', (req, res) => res.status(201).json(service.createPartner(validatePartner(req.body))));

  admin.get('/stats', (_req, res) => res.json(service.stats()));

  api.use('/admin', admin);
  api.use((_req, _res, next) => next(new HttpError(404, 'Route inconnue')));
  app.use('/api', api);

  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  // Gestion centralisée des erreurs
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'JSON invalide');
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Erreur interne' : err.message, details: err.details });
  });

  return app;
}

module.exports = { createApp, toCsv };
