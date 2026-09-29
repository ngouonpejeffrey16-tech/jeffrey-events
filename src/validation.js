'use strict';

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const SOURCES = ['instagram', 'tiktok', 'influenceur', 'bouche-a-oreille', 'site-web', 'autre'];
const PLATFORMS = ['instagram', 'tiktok', 'youtube', 'autre'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9 .-]{6,20}$/;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

function fail(errors) {
  if (Object.keys(errors).length) throw new HttpError(400, 'Données invalides', errors);
}

function validateRegistration(body = {}) {
  const data = {
    firstName: str(body.firstName),
    lastName: str(body.lastName),
    email: str(body.email).toLowerCase(),
    phone: str(body.phone),
    source: str(body.source) || 'autre',
    partnerCode: str(body.partnerCode).toUpperCase(),
  };
  const errors = {};
  if (data.firstName.length < 1 || data.firstName.length > 80) errors.firstName = 'Prénom requis (80 caractères max)';
  if (data.lastName.length < 1 || data.lastName.length > 80) errors.lastName = 'Nom requis (80 caractères max)';
  if (!EMAIL_RE.test(data.email) || data.email.length > 254) errors.email = 'Adresse e-mail invalide';
  if (data.phone && !PHONE_RE.test(data.phone)) errors.phone = 'Numéro de téléphone invalide';
  if (!SOURCES.includes(data.source)) errors.source = `Source inconnue (valeurs : ${SOURCES.join(', ')})`;
  if (data.partnerCode && !/^[A-Z0-9_-]{2,30}$/.test(data.partnerCode)) errors.partnerCode = 'Code partenaire invalide';
  if (body.consent !== true) errors.consent = "L'accord RGPD est obligatoire pour s'inscrire";
  fail(errors);
  return data;
}

function validateEvent(body = {}, { partial = false } = {}) {
  const errors = {};
  const out = {};
  const has = (k) => body[k] !== undefined;

  for (const [key, max] of [['title', 120], ['venue', 120], ['city', 80]]) {
    if (has(key) || !partial) {
      const v = str(body[key]);
      if (!v || v.length > max) errors[key] = `Champ requis (${max} caractères max)`;
      else out[key] = v;
    }
  }
  if (has('description')) out.description = str(body.description).slice(0, 2000);
  if (has('coverUrl')) {
    const v = str(body.coverUrl);
    if (v && !/^https?:\/\//.test(v)) errors.coverUrl = "L'URL de l'image doit commencer par http(s)://";
    else out.coverUrl = v;
  }
  if (has('startsAt') || !partial) {
    const d = new Date(body.startsAt);
    if (!body.startsAt || Number.isNaN(d.getTime())) errors.startsAt = 'Date invalide (format ISO attendu)';
    else out.startsAt = d.toISOString();
  }
  if (has('capacity') || !partial) {
    const n = Number(body.capacity);
    if (!Number.isInteger(n) || n < 1 || n > 100000) errors.capacity = 'Capacité : entier entre 1 et 100 000';
    else out.capacity = n;
  }
  if (has('priceEur')) {
    const n = Number(body.priceEur);
    if (!Number.isFinite(n) || n < 0) errors.priceEur = 'Prix invalide';
    else out.priceEur = Math.round(n * 100) / 100;
  }
  if (has('published')) out.published = body.published ? 1 : 0;
  fail(errors);
  return out;
}

function validatePartner(body = {}) {
  const data = { name: str(body.name), platform: str(body.platform).toLowerCase(), code: str(body.code).toUpperCase() };
  const errors = {};
  if (!data.name || data.name.length > 80) errors.name = 'Nom requis';
  if (!PLATFORMS.includes(data.platform)) errors.platform = `Plateforme : ${PLATFORMS.join(', ')}`;
  if (!/^[A-Z0-9_-]{2,30}$/.test(data.code)) errors.code = 'Code : 2 à 30 caractères (lettres, chiffres, - ou _)';
  fail(errors);
  return data;
}

module.exports = { HttpError, validateRegistration, validateEvent, validatePartner, SOURCES, PLATFORMS };
