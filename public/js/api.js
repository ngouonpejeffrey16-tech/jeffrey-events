// Petit client HTTP partagé entre la page publique et l'espace organisateur.
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details || {};
  }
}

export async function api(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['X-Admin-Token'] = token;
  const res = await fetch(`/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (res.status === 204) return null;
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json() : await res.blob();
  if (!res.ok) throw new ApiError(res.status, data?.error || 'Erreur réseau', data?.details);
  return data;
}

/** Crée un élément DOM (le texte passe toujours par textContent : pas d'injection HTML). */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'style') node.setAttribute('style', v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const formatDate = (iso) =>
  new Date(iso).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export const formatPrice = (eur) =>
  eur === 0 ? 'Gratuit' : eur.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

export const STATUS_LABEL = { confirmed: 'Confirmé', waitlist: "Liste d'attente", cancelled: 'Annulé' };
export const SOURCE_LABEL = {
  instagram: 'Instagram', tiktok: 'TikTok', influenceur: 'Influenceur', 'bouche-a-oreille': 'Bouche-à-oreille',
  'site-web': 'Site web', autre: 'Autre',
};
