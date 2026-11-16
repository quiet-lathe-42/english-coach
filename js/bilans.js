// Bilans hebdomadaires et mensuels, graphiques de progression, export.
import { db, kv } from './db.js';
import { etat, COMPETENCES, CATEGORIES, NIVEAUX, nomNiveau, serieDeJours } from './adaptation.js';
import { h } from './exercices.js';

const JOUR = 864e5;
const nomCat = c => CATEGORIES[c] || c;

// Calcule un bilan sur une période (les réponses du test de positionnement sont exclues).
export function calculer(debut, fin = Date.now()) {
  const T = etat.tentatives.filter(a => a.t >= debut && a.t < fin && !a.placement);
  const parComp = {};
  for (const c of Object.keys(COMPETENCES)) {
    const l = T.filter(a => a.skill === c);
    parComp[c] = { n: l.length, bons: l.filter(a => a.ok).length, niveau: nomNiveau(c) };
  }
  const cats = {};
  for (const a of T) for (const c of a.cats || []) {
    const v = cats[c] || (cats[c] = { cat: c, n: 0, err: 0 });
    v.n++; if (!a.ok) v.err++;
  }
  const erreurs = Object.values(cats).filter(v => v.err > 0).sort((a, b) => b.err - a.err || b.err / b.n - a.err / a.n);
  const objectifs = erreurs.slice(0, 3).map(v => `${nomCat(v.cat)} : refaire une dizaine d'exercices ciblés (${v.err} erreur${v.err > 1 ? 's' : ''} sur ${v.n}).`);
  const moins = Object.entries(parComp).sort((a, b) => a[1].n - b[1].n)[0];
  if (T.length) objectifs.push(`${COMPETENCES[moins[0]]} : c'est la compétence la moins travaillée (${moins[1].n} réponse${moins[1].n > 1 ? 's' : ''}). Vise 3 séances.`);
  return {
    debut, fin, total: T.length, bons: T.filter(a => a.ok).length,
    jours: new Set(T.map(a => new Date(a.t).toDateString())).size,
    parComp, erreurs, objectifs
  };
}

const pct = (a, b) => b ? Math.round(100 * a / b) + ' %' : '—';
const date = t => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

export function htmlBilan(b, { detail = false } = {}) {
  if (!b.total) return '<p class="petit">Aucun exercice sur cette période.</p>';
  let s = `<p><b>${b.total}</b> réponses sur <b>${b.jours}</b> jour${b.jours > 1 ? 's' : ''}, <b>${pct(b.bons, b.total)}</b> de réussite.</p>
  <table><thead><tr><th>Compétence</th><th class="num">Niveau</th><th class="num">Réponses</th><th class="num">Réussite</th></tr></thead><tbody>
  ${Object.entries(b.parComp).map(([c, v]) => `<tr><td>${COMPETENCES[c]}</td><td class="num">${v.niveau}</td><td class="num">${v.n}</td><td class="num">${pct(v.bons, v.n)}</td></tr>`).join('')}
  </tbody></table>`;
  const liste = detail ? b.erreurs : b.erreurs.slice(0, 5);
  s += `<h3>${detail ? 'Toutes les catégories d\'erreurs' : 'Mes 5 erreurs les plus fréquentes'}</h3>`;
  s += liste.length
    ? `<table><thead><tr><th>Catégorie</th><th class="num">Erreurs</th><th class="num">Sur</th></tr></thead><tbody>${liste.map(v => `<tr><td>${h(nomCat(v.cat))}</td><td class="num">${v.err}</td><td class="num">${v.n}</td></tr>`).join('')}</tbody></table>`
    : '<p class="petit">Aucune erreur sur cette période.</p>';
  s += `<h3>Objectifs pour la suite</h3><ul>${b.objectifs.map(o => `<li>${h(o)}</li>`).join('')}</ul>`;
  return s;
}

// Un petit graphique en escalier par compétence (niveau au fil du temps).
export function htmlGraphes() {
  if (!etat.niveaux) return '<p class="petit">Fais le test de positionnement pour voir ta progression.</p>';
  const L = 160, H = 96, gauche = 22, droite = 30, haut = 10, bas = 14;
  const t0 = Math.min(...Object.values(etat.niveaux).map(n => n.hist[0].t)), t1 = Math.max(Date.now(), t0 + JOUR);
  const x = t => gauche + (L - gauche - droite) * (t - t0) / (t1 - t0);
  const y = i => H - bas - (H - haut - bas) * i / (NIVEAUX.length - 1);
  const figures = Object.entries(COMPETENCES).map(([c, nom]) => {
    const hist = etat.niveaux[c].hist;
    let chemin = `M${x(hist[0].t).toFixed(1)},${y(hist[0].idx).toFixed(1)}`;
    for (let i = 1; i < hist.length; i++) chemin += ` H${x(hist[i].t).toFixed(1)} V${y(hist[i].idx).toFixed(1)}`;
    chemin += ` H${x(t1).toFixed(1)}`;
    const dernier = hist[hist.length - 1];
    return `<figure><figcaption>${nom}</figcaption>
    <svg viewBox="0 0 ${L} ${H}" role="img" aria-label="${nom} : niveau ${NIVEAUX[dernier.idx]}">
      ${[0, 1, 3, 5].map(i => `<line class="grille-h" x1="${gauche}" x2="${L - droite}" y1="${y(i)}" y2="${y(i)}"/><text x="2" y="${y(i) + 3}">${NIVEAUX[i]}</text>`).join('')}
      <path class="ligne" d="${chemin}"/>
      ${hist.map(p => `<g><circle class="point" cx="${x(p.t).toFixed(1)}" cy="${y(p.idx).toFixed(1)}" r="4"/><circle cx="${x(p.t).toFixed(1)}" cy="${y(p.idx).toFixed(1)}" r="10" fill="transparent"><title>${date(p.t)} : ${NIVEAUX[p.idx]}</title></circle></g>`).join('')}
      <text class="val" x="${L - droite + 4}" y="${y(dernier.idx) + 4}">${NIVEAUX[dernier.idx]}</text>
      <text x="${gauche}" y="${H - 2}">${date(t0)}</text><text x="${L - droite}" y="${H - 2}" text-anchor="end">${date(t1)}</text>
    </svg></figure>`;
  });
  return `<div class="graphes">${figures.join('')}</div>`;
}

const lundi = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; };

// À l'ouverture : fige le bilan de la semaine et du mois précédents s'ils ne le sont pas déjà.
export async function archiver() {
  const archives = await kv.get('bilans', []);
  const ceLundi = lundi(new Date()), lundiAvant = new Date(ceLundi - 7 * JOUR);
  const ceMois = new Date(new Date().getFullYear(), new Date().getMonth(), 1), moisAvant = new Date(ceMois.getFullYear(), ceMois.getMonth() - 1, 1);
  const aFaire = [
    { type: 'semaine', cle: 's-' + lundiAvant.toISOString().slice(0, 10), titre: `Semaine du ${date(lundiAvant)}`, debut: +lundiAvant, fin: +ceLundi },
    { type: 'mois', cle: 'm-' + moisAvant.getFullYear() + '-' + (moisAvant.getMonth() + 1), titre: moisAvant.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }), debut: +moisAvant, fin: +ceMois }
  ];
  let change = false;
  for (const p of aFaire) {
    if (archives.some(a => a.cle === p.cle)) continue;
    const b = calculer(p.debut, p.fin);
    if (!b.total) continue;
    archives.unshift({ ...p, bilan: b });
    change = true;
  }
  if (change) await kv.set('bilans', archives);
  return archives;
}

export function resumePourClaude() {
  const b = calculer(Date.now() - 30 * JOUR);
  const fautes = etat.tentatives.filter(a => !a.ok && a.detail).slice(-25).map(a => `- [${(a.cats || []).map(nomCat).join(', ')}] ${a.detail}`);
  return [
    'Voici mes résultats des 30 derniers jours dans mon application d\'entraînement à l\'anglais.',
    'Je suis étudiant français en master de génie mécanique et je travaille avec des collègues indiens.',
    '',
    `Niveaux estimés (CECRL) : ${Object.entries(COMPETENCES).map(([c, n]) => `${n} ${nomNiveau(c)}`).join(' ; ')}.`,
    `Activité : ${b.total} réponses sur ${b.jours} jours, ${pct(b.bons, b.total)} de réussite. Série en cours : ${serieDeJours()} jour(s).`,
    'Réussite par compétence : ' + Object.entries(b.parComp).map(([c, v]) => `${COMPETENCES[c]} ${pct(v.bons, v.n)} (${v.n})`).join(' ; ') + '.',
    'Catégories d\'erreurs (erreurs / essais) : ' + (b.erreurs.map(v => `${nomCat(v.cat)} ${v.err}/${v.n}`).join(' ; ') || 'aucune') + '.',
    '',
    'Mes dernières erreurs :',
    ...(fautes.length ? fautes : ['- aucune']),
    '',
    'Analyse mes points faibles, explique-moi les règles que je rate le plus avec des exemples, et propose-moi un plan de travail pour les deux prochaines semaines.'
  ].join('\n');
}

export async function exporter() {
  const donnees = {
    application: 'english-coach', version: 1, date: new Date().toISOString(),
    tentatives: etat.tentatives, revisions: Object.values(etat.revisions),
    kv: { niveaux: etat.niveaux, reglages: await kv.get('reglages', {}), bilans: await kv.get('bilans', []), liensPerso: await kv.get('liensPerso', []) }
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(donnees, null, 1)], { type: 'application/json' }));
  a.download = `english-coach-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function importer(texte) {
  const d = JSON.parse(texte);
  if (d.application !== 'english-coach' || !Array.isArray(d.tentatives)) throw new Error('Ce fichier ne vient pas de cette application.');
  await db.clear('tentatives'); await db.clear('revisions'); await db.clear('kv');
  for (const t of d.tentatives) await db.put('tentatives', t);
  for (const r of d.revisions || []) await db.put('revisions', r);
  for (const [cle, v] of Object.entries(d.kv || {})) if (v !== null && v !== undefined) await kv.set(cle, v);
}

export async function toutEffacer() {
  await db.clear('tentatives'); await db.clear('revisions'); await db.clear('kv');
}
