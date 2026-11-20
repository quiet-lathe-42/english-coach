// Niveaux, choix des exercices et répétition espacée.
import { db, kv } from './db.js';

export const NIVEAUX = ['A2', 'B1', 'B1+', 'B2', 'B2+', 'C1'];
// Niveaux d'exercices proposés pour chaque cran (un cran « + » mélange deux niveaux).
const BASSIN = [['B1'], ['B1'], ['B1', 'B2'], ['B2'], ['B2', 'C1'], ['C1']];

export const COMPETENCES = {
  ce: 'Compréhension écrite', co: 'Compréhension orale',
  ee: 'Expression écrite', eo: 'Expression orale'
};

export const CATEGORIES = {
  temps: 'Temps verbaux', prep: 'Prépositions', art: 'Articles', phrasal: 'Phrasal verbs',
  fauxamis: 'Faux amis', ordre: 'Ordre des mots', vocab: 'Vocabulaire technique',
  'ph-th': 'Sons /θ/ et /ð/ (th)', 'ph-h': 'Son /h/', 'ph-i': 'Sons /ɪ/ et /iː/',
  stress: 'Accent tonique', prononciation: 'Prononciation (autre)', fluidite: 'Fluidité à l\'oral',
  'comp-global': 'Idée principale', 'comp-detail': 'Compréhension de détail', 'vocab-ctx': 'Vocabulaire en contexte',
  dictee: 'Dictée', ortho: 'Orthographe', grammaire: 'Grammaire (autre)', registre: 'Registre et politesse',
  indien: 'Expressions de l\'anglais indien', interculturel: 'Codes interculturels'
};

// Règle de changement de niveau : sur les 20 dernières réponses d'une compétence,
// 80 % de réussite ou plus fait monter d'un cran, moins de 50 % fait descendre.
export const FENETRE = 20;
export const SEUIL_MONTEE = 0.8;
export const SEUIL_DESCENTE = 0.5;

const JOUR = 864e5;
const INTERVALLES = [1, 2, 4, 8, 16]; // jours, boîtes Leitner 1 à 5
const DEMI_VIE = 14;                  // jours : une erreur ancienne pèse moins

export const etat = { banque: [], parId: {}, tentatives: [], revisions: {}, niveaux: null, indien: null, liens: [] };

const melanger = l => { const a = [...l]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export async function charger() {
  const lire = f => fetch('data/' + f + '.json').then(r => r.json());
  const [ce, co, ee, eo, vocab, indien, liens] = await Promise.all(['ce', 'co', 'ee', 'eo', 'vocab', 'indien', 'liens'].map(lire));
  const termes = vocab.termes.map(t => ({ ...t, skill: 'voc', level: 'B2', type: 'vocab', cats: ['vocab'] }));
  // Un QCM par expression indienne : retrouver son sens parmi ceux des autres expressions.
  const quizExpr = indien.expressions.map((x, i, tous) => {
    const autres = tous.filter(y => y !== x).map(y => y.sens);
    const options = [x.sens, autres[(i * 3) % autres.length], autres[(i * 3 + 1) % autres.length], autres[(i * 3 + 2) % autres.length]];
    const ordre = melanger([0, 1, 2, 3]);
    return {
      id: 'ind-x-' + x.id, skill: 'ind', level: 'B2', type: 'qcm', cats: ['indien'],
      questions: [{ q: `In Indian workplace English, what does « ${x.expr} » mean?\n“${x.exemple}”`, options: ordre.map(k => options[k]), answer: ordre.indexOf(0), cat: 'indien', why: `Équivalent courant : ${x.standard}` }]
    };
  });
  const quizInd = indien.quiz.map(q => ({ ...q, skill: 'ind', level: 'B2', type: 'qcm' }));
  etat.banque = [...ce, ...co, ...ee, ...eo, ...termes, ...quizExpr, ...quizInd];
  for (const e of etat.banque) {
    if (!e.cats && e.questions) e.cats = [...new Set(e.questions.map(q => q.cat))];
    etat.parId[e.id] = e;
  }
  etat.indien = indien;
  etat.liens = liens;
  etat.tentatives = await db.all('tentatives');
  etat.revisions = Object.fromEntries((await db.all('revisions')).map(r => [r.exId, r]));
  etat.niveaux = await kv.get('niveaux', null);
}

export const cran = comp => etat.niveaux && etat.niveaux[comp] ? etat.niveaux[comp].idx : 3;
export const nomNiveau = comp => etat.niveaux && etat.niveaux[comp] ? NIVEAUX[etat.niveaux[comp].idx] : '—';

export async function fixerNiveaux(crans) {
  const t = Date.now();
  etat.niveaux = {};
  for (const c of Object.keys(COMPETENCES)) etat.niveaux[c] = { idx: crans[c], depuis: t, hist: [{ t, idx: crans[c] }] };
  await kv.set('niveaux', etat.niveaux);
}

// Enregistre les réponses d'un exercice. Renvoie un changement de niveau éventuel.
export async function enregistrer(ex, resultats, { placement = false, accent = '', seance = '' } = {}) {
  const t = Date.now();
  for (const r of resultats) {
    const ligne = { t, exId: ex.id, skill: ex.skill, level: ex.level, type: ex.type, ok: !!r.ok, cats: r.cats || ex.cats || [], detail: r.detail || '', texte: (r.texte || '').trim().slice(0, 3000), accent, placement, seance };
    ligne.id = await db.add('tentatives', ligne);
    etat.tentatives.push(ligne);
  }
  if (placement) return null;
  await majLeitner(ex.id, resultats.every(r => r.ok));
  return majNiveau(ex.skill);
}

async function majLeitner(exId, reussi) {
  const t = Date.now();
  let r = etat.revisions[exId];
  if (!reussi) r = { exId, boite: 1, echeance: t + INTERVALLES[0] * JOUR };
  else if (!r) return;
  else if (r.boite >= 5) { delete etat.revisions[exId]; return db.del('revisions', exId); }
  else r = { exId, boite: r.boite + 1, echeance: t + INTERVALLES[r.boite] * JOUR };
  etat.revisions[exId] = r;
  await db.put('revisions', r);
}

async function majNiveau(comp) {
  if (!COMPETENCES[comp] || !etat.niveaux) return null;
  const n = etat.niveaux[comp];
  const f = etat.tentatives.filter(x => x.skill === comp && !x.placement && x.t > n.depuis).slice(-FENETRE);
  if (f.length < FENETRE) return null;
  const taux = f.filter(x => x.ok).length / f.length;
  let nouveau = n.idx;
  if (taux >= SEUIL_MONTEE && n.idx < NIVEAUX.length - 1) nouveau++;
  else if (taux < SEUIL_DESCENTE && n.idx > 0) nouveau--;
  if (nouveau === n.idx) return null;
  const changement = { comp, de: NIVEAUX[n.idx], a: NIVEAUX[nouveau], monte: nouveau > n.idx };
  n.idx = nouveau; n.depuis = Date.now(); n.hist.push({ t: n.depuis, idx: nouveau });
  await kv.set('niveaux', etat.niveaux);
  return changement;
}

// Score de faiblesse par catégorie : taux d'erreur où les réponses récentes pèsent plus.
export function faiblesses(depuis = 0) {
  const t = Date.now(), m = {};
  for (const a of etat.tentatives) {
    if (a.t < depuis) continue;
    const poids = Math.pow(0.5, (t - a.t) / (DEMI_VIE * JOUR));
    for (const c of a.cats || []) {
      const v = m[c] || (m[c] = { n: 0, err: 0, p: 0, pe: 0 });
      v.n++; v.p += poids;
      if (!a.ok) { v.err++; v.pe += poids; }
    }
  }
  return Object.entries(m)
    .map(([cat, v]) => ({ cat, n: v.n, err: v.err, score: v.n >= 3 ? v.pe / v.p : 0 }))
    .sort((a, b) => b.score - a.score || b.err - a.err);
}

export const revisionsDues = () => Object.values(etat.revisions).filter(r => r.echeance <= Date.now());

// Compose une séance : 30 % de révisions arrivées à échéance, 50 % d'exercices
// sur les 3 catégories les plus faibles, le reste en nouveautés au niveau courant.
export function composerSeance(comp, n = 8, filtre = null) {
  const comps = comp ? [comp] : Object.keys(COMPETENCES);
  const vus = {};
  for (const a of etat.tentatives) vus[a.exId] = (vus[a.exId] || 0) + 1;
  const moinsVus = l => melanger(l).sort((a, b) => (vus[a.id] || 0) - (vus[b.id] || 0));
  const auNiveau = e => !COMPETENCES[e.skill] || BASSIN[cran(e.skill)].includes(e.level);
  const candidats = etat.banque.filter(e => comps.includes(e.skill) && auNiveau(e) && (!filtre || filtre(e)));
  const choisis = new Map();

  const dus = revisionsDues().map(r => etat.parId[r.exId]).filter(e => e && comps.includes(e.skill) && (!filtre || filtre(e)));
  for (const e of moinsVus(dus).slice(0, Math.ceil(n * 0.3))) choisis.set(e.id, e);

  const faibles = faiblesses().filter(f => f.score > 0).slice(0, 3).map(f => f.cat);
  let cibles = 0;
  for (const e of moinsVus(candidats.filter(x => (x.cats || []).some(c => faibles.includes(c))))) {
    if (cibles >= Math.ceil(n * 0.5) || choisis.size >= n) break;
    if (!choisis.has(e.id)) { choisis.set(e.id, e); cibles++; }
  }

  const files = comps.map(c => moinsVus(candidats.filter(e => e.skill === c && !choisis.has(e.id))));
  for (let i = 0; choisis.size < n && files.some(f => f.length); i++) {
    const e = files[i % files.length].shift();
    if (e) choisis.set(e.id, e);
  }
  return melanger([...choisis.values()]).slice(0, n);
}

// Deux exercices corrigés automatiquement, pour le test de positionnement.
export function exercicesPositionnement(comp, niveau) {
  const types = { ce: ['qcm'], co: ['qcm'], ee: ['correction'], eo: ['dire'] }[comp];
  return etat.banque.filter(e => e.skill === comp && e.level === niveau && types.includes(e.type)).slice(0, 2);
}

export function serieDeJours() {
  const jours = new Set(etat.tentatives.map(a => new Date(a.t).toDateString()));
  let d = new Date(), n = 0;
  if (!jours.has(d.toDateString())) d = new Date(d - JOUR);
  while (jours.has(d.toDateString())) { n++; d = new Date(d - JOUR); }
  return n;
}
