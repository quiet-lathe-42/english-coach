// Suivi automatique : envoie les réponses vers le Google Sheets privé de l'utilisateur.
// Claude lit ce tableau chaque soir, envoie un bilan par mail et ajoute des exercices ciblés.
// L'adresse du script (avec sa clé) reste sur le téléphone : elle n'est jamais dans le dépôt.
import { kv } from './db.js';
import { etat, COMPETENCES, NIVEAUX, cran } from './adaptation.js';

const PAR_LOT = 400;
const DELAI = 30000;
let enCours = null;

export const urlSuivi = () => kv.get('suivi', '');
export const etatSuivi = () => kv.get('suiviDernier', null);
export const adresseValide = u => /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec\?k=[\w-]+$/.test(u);

export async function definirUrl(u) {
  await kv.set('suivi', u);
  await kv.set('suiviDernier', null);
}

async function appareil() {
  let a = await kv.get('appareil', '');
  if (!a) {
    a = Array.from(crypto.getRandomValues(new Uint8Array(6)), o => o.toString(16).padStart(2, '0')).join('');
    await kv.set('appareil', a);
  }
  return a;
}

const dateLocale = t => {
  const d = new Date(t), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

async function poster(url, corps) {
  const ctrl = new AbortController(), minuteur = setTimeout(() => ctrl.abort(), DELAI);
  try {
    // Pas d'en-tête Content-Type : la requête reste « simple » et passe sans pré-vérification CORS.
    const r = await fetch(url, { method: 'POST', body: JSON.stringify(corps), signal: ctrl.signal });
    const j = await r.json();
    if (!j.ok) throw new Error(j.erreur || 'envoi refusé');
    return j;
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'pas de réponse du script' : e.message);
  } finally {
    clearTimeout(minuteur);
  }
}

export const tester = url => poster(url, { test: true });

export async function enAttente() {
  const dernier = await kv.get('suiviDernierId', 0);
  return etat.tentatives.filter(a => a.id > dernier).length;
}

// Envoie les réponses pas encore transmises. Sans adresse ou sans connexion, ne fait rien :
// elles partiront à la prochaine occasion (fin de séance, ouverture de l'appli, retour du réseau).
export function synchroniser() {
  if (!enCours) enCours = envoyer().finally(() => { enCours = null; });
  return enCours;
}

async function envoyer() {
  const url = await urlSuivi();
  if (!url) return { statut: 'inactif' };
  if (!navigator.onLine) return { statut: 'horsligne' };
  const dernier = await kv.get('suiviDernierId', 0);
  const aEnvoyer = etat.tentatives.filter(a => a.id > dernier).sort((a, b) => a.id - b.id);
  if (!aEnvoyer.length) return { statut: 'ajour' };
  const app = await appareil();
  // Niveau réellement utilisé pour choisir les exercices (B2 par défaut avant le test de positionnement).
  const niveaux = Object.fromEntries(Object.keys(COMPETENCES).map(c => [c, NIVEAUX[cran(c)]]));
  let ajoutees = 0;
  try {
    for (let i = 0; i < aEnvoyer.length; i += PAR_LOT) {
      const lot = aEnvoyer.slice(i, i + PAR_LOT);
      const j = await poster(url, {
        appareil: app, niveaux,
        reponses: lot.map(a => ({
          id: a.id, date: dateLocale(a.t), competence: a.skill, niveau: a.level, type: a.type, exercice: a.exId,
          ok: a.ok, categories: (a.cats || []).join(', '), detail: a.detail || '', texte: a.texte || '',
          accent: a.accent || '', test: !!a.placement, seance: a.seance || ''
        }))
      });
      ajoutees += j.ajoutees || 0;
      await kv.set('suiviDernierId', lot[lot.length - 1].id);
    }
    await kv.set('suiviDernier', { t: Date.now(), ok: true, n: aEnvoyer.length });
    return { statut: 'ok', ajoutees };
  } catch (e) {
    await kv.set('suiviDernier', { t: Date.now(), ok: false, erreur: e.message });
    return { statut: 'erreur', erreur: e.message };
  }
}
