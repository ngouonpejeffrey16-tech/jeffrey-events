'use strict';

// Logique métier : événements, inscriptions (capacité + liste d'attente), check-in, statistiques.
const crypto = require('node:crypto');
const { transaction } = require('./db');
const { HttpError } = require('./validation');

const TICKET_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I pour éviter les confusions

function newTicketCode() {
  const bytes = crypto.randomBytes(8);
  let code = 'JE-';
  for (let i = 0; i < 8; i++) code += TICKET_ALPHABET[bytes[i] % TICKET_ALPHABET.length];
  return code;
}

function mapEvent(row) {
  if (!row) return null;
  const confirmed = Number(row.confirmed ?? 0);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    venue: row.venue,
    city: row.city,
    startsAt: row.starts_at,
    capacity: row.capacity,
    priceEur: row.price_eur,
    coverUrl: row.cover_url,
    published: Boolean(row.published),
    confirmed,
    waitlist: Number(row.waitlist ?? 0),
    remaining: Math.max(0, row.capacity - confirmed),
    createdAt: row.created_at,
  };
}

function mapRegistration(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    source: row.source,
    partner: row.partner_code ? { code: row.partner_code, name: row.partner_name } : null,
    status: row.status,
    ticketCode: row.ticket_code,
    checkedInAt: row.checked_in_at,
    createdAt: row.created_at,
  };
}

const EVENT_SELECT = `
  SELECT e.*,
         (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'confirmed') AS confirmed,
         (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'waitlist')  AS waitlist
  FROM events e`;

const REG_SELECT = `
  SELECT r.*, p.code AS partner_code, p.name AS partner_name
  FROM registrations r LEFT JOIN partners p ON p.id = r.partner_id`;

function createService(db) {
  const getEventRow = (id) => db.prepare(`${EVENT_SELECT} WHERE e.id = ?`).get(id);

  function requireEvent(id, { publicOnly = false } = {}) {
    const row = getEventRow(Number(id));
    if (!row || (publicOnly && !row.published)) throw new HttpError(404, 'Événement introuvable');
    return row;
  }

  function getRegistrationByCode(code) {
    const row = db.prepare(`${REG_SELECT} WHERE r.ticket_code = ?`).get(String(code).toUpperCase());
    if (!row) throw new HttpError(404, 'Billet introuvable');
    return row;
  }

  return {
    // ---------- Événements ----------
    listEvents({ includeUnpublished = false, upcomingOnly = false } = {}) {
      const where = [];
      if (!includeUnpublished) where.push('e.published = 1');
      if (upcomingOnly) where.push(`e.starts_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
      const sql = `${EVENT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.starts_at ASC`;
      return db.prepare(sql).all().map(mapEvent);
    },

    getEvent(id, opts) {
      return mapEvent(requireEvent(id, opts));
    },

    createEvent(data) {
      const info = db
        .prepare(
          `INSERT INTO events (title, description, venue, city, starts_at, capacity, price_eur, cover_url, published)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          data.title,
          data.description ?? '',
          data.venue,
          data.city,
          data.startsAt,
          data.capacity,
          data.priceEur ?? 0,
          data.coverUrl ?? '',
          data.published ?? 1
        );
      return this.getEvent(info.lastInsertRowid);
    },

    updateEvent(id, data) {
      return transaction(db, () => {
        const current = requireEvent(id);
        const cols = {
          title: 'title', description: 'description', venue: 'venue', city: 'city', startsAt: 'starts_at',
          capacity: 'capacity', priceEur: 'price_eur', coverUrl: 'cover_url', published: 'published',
        };
        const sets = [];
        const values = [];
        for (const [k, col] of Object.entries(cols)) {
          if (data[k] !== undefined) {
            sets.push(`${col} = ?`);
            values.push(data[k]);
          }
        }
        if (data.capacity !== undefined && data.capacity < current.confirmed) {
          throw new HttpError(409, `Capacité trop faible : ${current.confirmed} participants déjà confirmés`);
        }
        if (sets.length) db.prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`).run(...values, current.id);
        // Si la capacité augmente, on fait monter la liste d'attente
        promoteWaitlist(current.id);
        return mapEvent(getEventRow(current.id));
      });
    },

    deleteEvent(id) {
      const row = requireEvent(id);
      db.prepare('DELETE FROM events WHERE id = ?').run(row.id);
    },

    // ---------- Inscriptions ----------
    register(eventId, data) {
      return transaction(db, () => {
        const event = requireEvent(eventId, { publicOnly: true });
        if (new Date(event.starts_at) < new Date()) throw new HttpError(409, 'Cet événement est déjà passé');

        const dup = db
          .prepare(`SELECT 1 FROM registrations WHERE event_id = ? AND email = ? AND status <> 'cancelled'`)
          .get(event.id, data.email);
        if (dup) throw new HttpError(409, 'Cette adresse e-mail est déjà inscrite à cet événement');

        let partnerId = null;
        let source = data.source;
        if (data.partnerCode) {
          const partner = db.prepare('SELECT id FROM partners WHERE code = ?').get(data.partnerCode);
          if (!partner) throw new HttpError(400, 'Données invalides', { partnerCode: 'Code partenaire inconnu' });
          partnerId = partner.id;
          if (source === 'autre') source = 'influenceur';
        }

        const status = event.confirmed < event.capacity ? 'confirmed' : 'waitlist';
        const ticket = newTicketCode();
        db.prepare(
          `INSERT INTO registrations (event_id, first_name, last_name, email, phone, source, partner_id, status, ticket_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(event.id, data.firstName, data.lastName, data.email, data.phone, source, partnerId, status, ticket);
        return mapRegistration(getRegistrationByCode(ticket));
      });
    },

    getTicket(code) {
      const reg = mapRegistration(getRegistrationByCode(code));
      const event = mapEvent(getEventRow(reg.eventId));
      let waitlistPosition = null;
      if (reg.status === 'waitlist') {
        waitlistPosition = db
          .prepare(`SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND status = 'waitlist' AND id <= ?`)
          .get(reg.eventId, reg.id).n;
      }
      return { ...reg, waitlistPosition, event };
    },

    cancel(code) {
      return transaction(db, () => {
        const row = getRegistrationByCode(code);
        if (row.status === 'cancelled') throw new HttpError(409, 'Inscription déjà annulée');
        if (row.checked_in_at) throw new HttpError(409, 'Impossible d’annuler : participant déjà enregistré à l’entrée');
        db.prepare(`UPDATE registrations SET status = 'cancelled' WHERE id = ?`).run(row.id);
        const promoted = promoteWaitlist(row.event_id);
        return { cancelled: row.ticket_code, promoted };
      });
    },

    checkIn(code) {
      return transaction(db, () => {
        const row = getRegistrationByCode(code);
        if (row.status !== 'confirmed') throw new HttpError(409, `Billet non valide (statut : ${row.status})`);
        if (row.checked_in_at) throw new HttpError(409, `Billet déjà scanné le ${row.checked_in_at}`);
        db.prepare(`UPDATE registrations SET checked_in_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(row.id);
        return mapRegistration(getRegistrationByCode(code));
      });
    },

    listRegistrations(eventId, { status } = {}) {
      requireEvent(eventId);
      const params = [Number(eventId)];
      let sql = `${REG_SELECT} WHERE r.event_id = ?`;
      if (status) {
        sql += ' AND r.status = ?';
        params.push(status);
      }
      sql += ' ORDER BY r.id ASC';
      return db.prepare(sql).all(...params).map(mapRegistration);
    },

    // ---------- Partenaires / influenceurs ----------
    listPartners() {
      return db
        .prepare(
          `SELECT p.*, COUNT(r.id) FILTER (WHERE r.status <> 'cancelled') AS registrations
           FROM partners p LEFT JOIN registrations r ON r.partner_id = p.id
           GROUP BY p.id ORDER BY registrations DESC, p.name`
        )
        .all()
        .map((p) => ({ id: p.id, name: p.name, platform: p.platform, code: p.code, registrations: p.registrations }));
    },

    createPartner(data) {
      try {
        const info = db.prepare('INSERT INTO partners (name, platform, code) VALUES (?, ?, ?)').run(data.name, data.platform, data.code);
        return { id: Number(info.lastInsertRowid), ...data, registrations: 0 };
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) throw new HttpError(409, 'Ce code partenaire existe déjà');
        throw err;
      }
    },

    // ---------- Statistiques (tableau de bord) ----------
    stats() {
      const totals = db
        .prepare(
          `SELECT COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
                  COUNT(*) FILTER (WHERE status = 'waitlist')  AS waitlist,
                  COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
                  COUNT(*) FILTER (WHERE checked_in_at IS NOT NULL) AS checkedIn
           FROM registrations`
        )
        .get();
      const bySource = db
        .prepare(
          `SELECT source, COUNT(*) AS count FROM registrations WHERE status <> 'cancelled'
           GROUP BY source ORDER BY count DESC`
        )
        .all()
        .map((r) => ({ source: r.source, count: r.count }));
      const events = this.listEvents({ includeUnpublished: true }).map((e) => {
        const checked = db
          .prepare(`SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND checked_in_at IS NOT NULL`)
          .get(e.id).n;
        return {
          id: e.id,
          title: e.title,
          startsAt: e.startsAt,
          capacity: e.capacity,
          confirmed: e.confirmed,
          waitlist: e.waitlist,
          fillRate: Math.round((e.confirmed / e.capacity) * 1000) / 10,
          checkedIn: checked,
          revenueEur: Math.round(e.confirmed * e.priceEur * 100) / 100,
        };
      });
      return { totals: { ...totals }, bySource, partners: this.listPartners(), events };
    },
  };

  /** Fait passer les premières personnes en liste d'attente en « confirmé » tant qu'il reste des places. */
  function promoteWaitlist(eventId) {
    const event = getEventRow(eventId);
    const free = event.capacity - event.confirmed;
    if (free <= 0) return [];
    const rows = db
      .prepare(`SELECT id, ticket_code FROM registrations WHERE event_id = ? AND status = 'waitlist' ORDER BY id LIMIT ?`)
      .all(eventId, free);
    const upd = db.prepare(`UPDATE registrations SET status = 'confirmed' WHERE id = ?`);
    for (const r of rows) upd.run(r.id);
    return rows.map((r) => r.ticket_code);
  }
}

module.exports = { createService, newTicketCode };
