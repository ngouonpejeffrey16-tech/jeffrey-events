'use strict';

// Remplit la base avec des données de démonstration (événements, partenaires, inscriptions fictives).
const path = require('node:path');
const { openDatabase } = require('../src/db');
const { createService } = require('../src/service');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'jeffrey-events.db');
const db = openDatabase(DB_FILE);
db.exec('DELETE FROM registrations; DELETE FROM partners; DELETE FROM events;');
const s = createService(db);

const inDays = (n, hour = 21) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

const events = [
  s.createEvent({
    title: 'Soirée Afro Vibes',
    description: 'Afrobeats, amapiano et coupé-décalé toute la nuit avec deux DJ invités.',
    venue: 'Le Hangar', city: 'Bordeaux', startsAt: inDays(12), capacity: 120, priceEur: 15,
  }),
  s.createEvent({
    title: 'Afterwork Networking Tech',
    description: 'Rencontres entre étudiants, startups et recruteurs de la tech bordelaise.',
    venue: 'Darwin Écosystème', city: 'Bordeaux', startsAt: inDays(20, 18), capacity: 60, priceEur: 0,
  }),
  s.createEvent({
    title: 'Tournoi de foot 5 solidaire',
    description: 'Tournoi par équipes de 5, recettes reversées à une association locale.',
    venue: 'UrbanSoccer', city: 'Mérignac', startsAt: inDays(33, 14), capacity: 40, priceEur: 10,
  }),
];

const partners = [
  s.createPartner({ name: 'Compte Instagram @bdx.nightlife', platform: 'instagram', code: 'BDXNIGHT' }),
  s.createPartner({ name: 'Créatrice TikTok @lea.sort', platform: 'tiktok', code: 'LEASORT' }),
];

const firstNames = ['Inès', 'Hugo', 'Awa', 'Lucas', 'Chloé', 'Yanis', 'Maëlle', 'Karim', 'Sarah', 'Théo', 'Fatou', 'Nathan'];
const lastNames = ['Martin', 'Diallo', 'Bernard', 'Nguyen', 'Petit', 'Mbappé', 'Leroy', 'Moreau', 'Kouassi', 'Garcia'];
const sources = ['instagram', 'instagram', 'tiktok', 'tiktok', 'bouche-a-oreille', 'site-web'];
let n = 0;
const fill = (event, count) => {
  for (let i = 0; i < count; i++, n++) {
    const usePartner = n % 4 === 0;
    s.register(event.id, {
      firstName: firstNames[n % firstNames.length],
      lastName: lastNames[(n * 7) % lastNames.length],
      email: `participant${n}@example.com`,
      phone: '',
      source: usePartner ? 'autre' : sources[n % sources.length],
      partnerCode: usePartner ? partners[(n / 4) % 2].code : '',
    });
  }
};
fill(events[0], 96);
fill(events[1], 64); // 60 places → 4 personnes en liste d'attente
fill(events[2], 18);

console.log(`Base de démonstration prête : ${DB_FILE}`);
console.log(`${events.length} événements, ${partners.length} partenaires, ${n} inscriptions.`);
db.close();
