// Écrans et navigation.
import { kv } from './db.js';
import { etat, charger, COMPETENCES, CATEGORIES, NIVEAUX, FENETRE, SEUIL_MONTEE, SEUIL_DESCENTE, nomNiveau, fixerNiveaux, enregistrer, faiblesses, revisionsDues, composerSeance, exercicesPositionnement, serieDeJours } from './adaptation.js';
import { ACCENTS, reglages, sauverReglages, initVoix, aSynthese, aReco, voixPour, nbVoix, dire, arreter } from './voix.js';
import { afficher, h } from './exercices.js';
import { calculer, htmlBilan, htmlGraphes, archiver, resumePourClaude, exporter, importer, toutEffacer } from './bilans.js';
import { synchroniser, urlSuivi, etatSuivi, enAttente, definirUrl, tester, adresseValide } from './suivi.js';

const ecran = document.getElementById('ecran');
const JOUR = 864e5;
const ICONES = { ce: '📖', co: '🎧', ee: '✍️', eo: '🗣️' };
let seanceEnCours = null; // jeton : changer d'écran annule la séance

const page = html => { ecran.innerHTML = html; window.scrollTo(0, 0); };
const clic = (sel, f) => ecran.querySelectorAll(sel).forEach(b => b.addEventListener('click', f));

// ---------- Séance ----------
async function lancerSeance(exercices, titre, { placement = false } = {}) {
  if (!exercices.length) { page(`<h1>${h(titre)}</h1><p>Aucun exercice disponible pour l'instant.</p><a class="bouton" href="#/entrainement">Retour</a>`); return null; }
  const jeton = seanceEnCours = {};
  document.body.classList.add('en-seance');
  const bilan = [], changements = [];
  for (let i = 0; i < exercices.length; i++) {
    const ex = exercices[i];
    page(`<div class="rangee" style="justify-content:space-between"><span class="petit">${h(titre)} · ${i + 1}/${exercices.length}</span><button id="quitter" style="min-height:40px;flex:none">Quitter</button></div>
      <div class="progression"><i style="width:${100 * i / exercices.length}%"></i></div>
      <p><span class="etiquette">${h(COMPETENCES[ex.skill] || { voc: 'Vocabulaire', ind: 'Anglais indien' }[ex.skill])}</span><span class="etiquette">${ex.level}</span></p>
      <div id="zone"></div>`);
    document.getElementById('quitter').onclick = () => { location.hash = placement ? '#/accueil' : '#/entrainement'; };
    const { resultats, accent } = await afficher(ex, document.getElementById('zone'));
    if (seanceEnCours !== jeton) return null;
    const ch = await enregistrer(ex, resultats, { placement, accent, seance: titre });
    if (ch) changements.push(ch);
    bilan.push({ ex, resultats });
  }
  seanceEnCours = null;
  document.body.classList.remove('en-seance');
  return { bilan, changements };
}

function finDeSeance(res, titre) {
  if (!res) return;
  synchroniser();
  const tout = res.bilan.flatMap(b => b.resultats), bons = tout.filter(r => r.ok).length;
  const ratees = [...new Set(tout.filter(r => !r.ok).flatMap(r => r.cats))];
  page(`<h1>Séance terminée</h1>
    <div class="carte centre"><div class="niveau" style="font-size:2rem;font-weight:700">${bons} / ${tout.length}</div><p class="petit">${h(titre)}</p></div>
    ${res.changements.map(c => `<div class="retour ${c.monte ? 'bon' : 'faux'}">${c.monte ? '🎉' : '↘️'} ${COMPETENCES[c.comp]} : tu passes de <b>${c.de}</b> à <b>${c.a}</b>.</div>`).join('')}
    ${ratees.length ? `<p>À retravailler : ${ratees.map(c => `<span class="etiquette">${h(CATEGORIES[c] || c)}</span>`).join(' ')}</p><p class="petit">Les exercices ratés reviendront demain dans tes révisions.</p>` : '<p>Aucune erreur, bravo.</p>'}
    <a class="bouton principal large" href="#/accueil">Retour à l'accueil</a>
    <a class="bouton large" href="#/entrainement">Continuer à s'entraîner</a>`);
}

async function seance(comp, titre, n = 8, filtre = null) {
  finDeSeance(await lancerSeance(composerSeance(comp, n, filtre), titre), titre);
}

// ---------- Test de positionnement ----------
function ecranPositionnement() {
  page(`<h1>Test de positionnement</h1>
    <p>Ce test estime ton niveau (de A2 à C1) dans les quatre compétences. Il dure <b>15 minutes au plus</b> et s'arrête tout seul quand les questions deviennent trop difficiles.</p>
    <ul><li>📖 Lecture : de courts textes avec des questions.</li><li>🎧 Écoute : des audios avec des questions. Monte le son.</li><li>✍️ Écrit : des phrases à corriger.</li><li>🗣️ Oral : des phrases à dire${aReco ? '. Autorise le micro quand le téléphone le demande' : ' (non évalué ici : la reconnaissance vocale n\'est pas disponible sur ce navigateur)'}.</li></ul>
    <p class="petit">Le résultat est un indicateur pour régler la difficulté, pas une certification.</p>
    <button class="principal large" id="go">Commencer</button>`);
  document.getElementById('go').onclick = passerPositionnement;
}

async function passerPositionnement() {
  const crans = {};
  for (const comp of Object.keys(COMPETENCES)) {
    if (comp === 'eo' && !aReco) { crans.eo = 3; continue; }
    let cran = 0;
    for (const [k, niveau] of ['B1', 'B2', 'C1'].entries()) {
      const exos = exercicesPositionnement(comp, niveau);
      const res = await lancerSeance(exos, `Positionnement · ${COMPETENCES[comp]}`, { placement: true });
      if (!res) return;
      const reussis = res.bilan.filter(b => b.resultats.filter(r => r.ok).length / b.resultats.length >= 2 / 3).length;
      if (reussis === 2) { cran = [1, 3, 5][k]; continue; }
      if (reussis === 1) cran = [1, 2, 4][k];
      break;
    }
    crans[comp] = cran;
  }
  await fixerNiveaux(crans);
  page(`<h1>Ton niveau de départ</h1>
    <div class="grille">${Object.entries(COMPETENCES).map(([c, nom]) => `<div class="tuile"><span>${ICONES[c]} ${nom}</span><span class="niveau">${nomNiveau(c)}</span></div>`).join('')}</div>
    ${aReco ? '' : '<p class="petit">L\'oral n\'a pas pu être évalué : il démarre à B2 et s\'ajustera avec tes auto-évaluations.</p>'}
    <p>La difficulté s'ajustera ensuite toute seule : sur tes ${FENETRE} dernières réponses dans une compétence, ${SEUIL_MONTEE * 100} % de réussite te fait monter d'un cran, moins de ${SEUIL_DESCENTE * 100} % te fait descendre.</p>
    <a class="bouton principal large" href="#/accueil">C'est parti</a>`);
}

// ---------- Accueil ----------
function accueil() {
  if (!etat.niveaux) {
    page(`<h1>English Coach</h1>
      <p>Bienvenue. Commence par le test de positionnement : l'application saura quels exercices te proposer.</p>
      <a class="bouton principal large" href="#/positionnement">Faire le test (15 min)</a>
      ${alerteVoix()}`);
    return;
  }
  const serie = serieDeJours(), dues = revisionsDues().length;
  const faibles = faiblesses().filter(f => f.score > 0).slice(0, 3);
  const aujourdhui = etat.tentatives.filter(a => new Date(a.t).toDateString() === new Date().toDateString()).length;
  page(`<h1>English Coach</h1>
    <div class="carte"><b>🔥 ${serie} jour${serie > 1 ? 's' : ''} d'affilée</b>
      <p class="petit">${aujourdhui ? `${aujourdhui} réponse${aujourdhui > 1 ? 's' : ''} aujourd'hui.` : 'Pas encore de séance aujourd\'hui.'} ${dues ? `${dues} révision${dues > 1 ? 's' : ''} à faire.` : ''}</p></div>
    <a class="bouton principal large" href="#/seance/jour">▶ Séance du jour (10 min)</a>
    <h2>Mes niveaux</h2>
    <div class="grille">${Object.entries(COMPETENCES).map(([c, nom]) => `<a class="tuile" href="#/seance/${c}"><span>${ICONES[c]} ${nom}</span><span class="niveau">${nomNiveau(c)}</span></a>`).join('')}</div>
    ${faibles.length ? `<h2>Mes points faibles du moment</h2><p>${faibles.map(f => `<span class="etiquette">${h(CATEGORIES[f.cat] || f.cat)} · ${Math.round(f.score * 100)} % d'erreurs</span>`).join(' ')}</p>` : ''}
    ${alerteVoix()}`);
}

function alerteVoix() {
  if (!aSynthese) return '<div class="alerte">Ce navigateur ne sait pas lire de texte à voix haute. Utilise Chrome sur Android.</div>';
  if (voixPour('en-IN').length) return '';
  return '<div class="alerte">⚠️ Aucune voix à accent indien n\'est installée sur cet appareil. <a href="#/reglages">Voir comment l\'installer</a>.</div>';
}

// ---------- S'entraîner ----------
function entrainement() {
  page(`<h1>S'entraîner</h1>
    <div class="grille">
      ${Object.entries(COMPETENCES).map(([c, nom]) => `<a class="tuile" href="#/seance/${c}"><b>${ICONES[c]} ${nom}</b><span class="petit">Niveau ${nomNiveau(c)}</span></a>`).join('')}
      <a class="tuile" href="#/seance/dictee"><b>⌨️ Dictée</b><span class="petit">Écrire ce que j'entends, avec l'accent indien</span></a>
      <a class="tuile" href="#/seance/vocab"><b>🔩 Vocabulaire</b><span class="petit">Génie mécanique, en révisions espacées</span></a>
      <a class="tuile" href="#/liens"><b>🎬 Audios authentiques</b><span class="petit">De vraies voix indiennes</span></a>
      <a class="tuile" href="#/carnet"><b>📓 Carnet d'erreurs</b><span class="petit">${etat.tentatives.filter(a => !a.ok).length} erreurs notées</span></a>
    </div>
    ${etat.niveaux ? '' : '<div class="alerte">Tu n\'as pas encore fait le test de positionnement : les exercices sont réglés sur B2. <a href="#/positionnement">Faire le test</a>.</div>'}`);
}

function carnet() {
  const erreurs = etat.tentatives.filter(a => !a.ok && a.detail).slice(-150).reverse();
  const parCat = {};
  for (const a of erreurs) for (const c of a.cats || ['autre']) (parCat[c] = parCat[c] || []).push(a);
  const groupes = Object.entries(parCat).sort((a, b) => b[1].length - a[1].length);
  page(`<h1>Carnet d'erreurs</h1>
    ${groupes.length ? groupes.map(([c, l]) => `<details class="carte"><summary>${h(CATEGORIES[c] || c)} (${l.length})</summary>
      ${l.map(a => `<p>${h(a.detail)}<br><span class="petit">${new Date(a.t).toLocaleDateString('fr-FR')}</span></p>`).join('')}</details>`).join('')
      : '<p>Aucune erreur enregistrée pour l\'instant.</p>'}
    <a class="bouton large" href="#/entrainement">Retour</a>`);
}

async function liens() {
  const perso = await kv.get('liensPerso', []);
  const ligne = (l, i) => `<div class="carte"><b>${h(l.titre)}</b>${l.note ? `<p class="petit">${h(l.note)}</p>` : ''}
    ${l.url ? `<a class="bouton" href="${h(l.url)}" target="_blank" rel="noopener">Ouvrir</a>` : '<p class="petit">[à compléter]</p>'}
    ${i !== undefined ? ` <button data-suppr="${i}" style="min-height:40px">Retirer</button>` : ''}</div>`;
  page(`<h1>Audios authentiques</h1>
    <p>Les voix du téléphone imitent mal un vrai accent. Entraîne-toi aussi sur de vraies voix indiennes.</p>
    <div class="carte"><b>Exercice type (10 min)</b><ol style="margin:6px 0;padding-left:20px">
      <li>Écoute 3 à 5 minutes sans sous-titres.</li><li>Note 5 mots ou expressions que tu n'as pas compris.</li>
      <li>Dégage l'idée principale en une phrase.</li><li>Résume en 3 phrases en anglais, à l'écrit ou à l'oral.</li>
      <li>Réécoute avec les sous-titres pour vérifier.</li></ol></div>
    <h2>Sources proposées</h2>${etat.liens.map(l => ligne(l)).join('')}
    <h2>Mes liens</h2>${perso.map((l, i) => ligne(l, i)).join('') || '<p class="petit">Aucun lien ajouté.</p>'}
    <div class="carte"><input type="text" id="lt" placeholder="Titre"><p></p><input type="text" id="lu" placeholder="Adresse (https://…)" inputmode="url"><button class="large" id="ajout">Ajouter ce lien</button></div>
    <a class="bouton large" href="#/entrainement">Retour</a>`);
  document.getElementById('ajout').onclick = async () => {
    const titre = document.getElementById('lt').value.trim(), url = document.getElementById('lu').value.trim();
    if (!titre || !/^https?:\/\//.test(url)) return;
    await kv.set('liensPerso', [...perso, { titre, url }]); liens();
  };
  clic('[data-suppr]', async e => { perso.splice(Number(e.currentTarget.dataset.suppr), 1); await kv.set('liensPerso', perso); liens(); });
}

// ---------- Anglais indien ----------
function indien() {
  const d = etat.indien, ecoute = t => `<button data-dire="${h(t)}" style="min-height:36px;padding:4px 10px" aria-label="Écouter">▶</button>`;
  page(`<h1>Anglais indien</h1>
    <p>L'anglais indien est une variété à part entière, parlée par des centaines de millions de personnes. Ces fiches t'aident à le comprendre plus vite.</p>
    <a class="bouton principal large" href="#/seance/indien">Quiz (8 questions)</a>
    <details class="carte" open><summary>Expressions courantes au travail (${d.expressions.length})</summary>
      ${d.expressions.map(x => `<p><b>${h(x.expr)}</b> : ${h(x.sens)}<br><i>${h(x.exemple)}</i> ${ecoute(x.exemple)}<br><span class="petit">Équivalent courant : ${h(x.standard)}</span></p>`).join('')}</details>
    <details class="carte"><summary>Prononciation : à quoi s'attendre</summary>
      ${d.traits.map(x => `<p><b>${h(x.titre)}</b><br>${h(x.texte)}${x.exemple ? `<br><i>${h(x.exemple)}</i> ${ecoute(x.exemple)}` : ''}</p>`).join('')}</details>
    <details class="carte"><summary>Codes de communication</summary>
      ${d.interculturel.map(x => `<p><b>${h(x.titre)}</b><br>${h(x.texte)}${x.phrase ? `<br><i>${h(x.phrase)}</i> ${ecoute(x.phrase)}` : ''}</p>`).join('')}
      <p class="petit">Ce sont des tendances, pas des règles : chaque personne et chaque équipe est différente.</p></details>`);
  clic('[data-dire]', e => dire(e.currentTarget.dataset.dire, { accent: 'en-IN' }));
}

// ---------- Bilans ----------
async function bilans() {
  const archives = await archiver();
  page(`<h1>Bilans</h1>
    <h2>Progression par compétence</h2>${htmlGraphes()}
    <h2>Bilan de la semaine (7 derniers jours)</h2><div class="carte">${htmlBilan(calculer(Date.now() - 7 * JOUR))}</div>
    <h2>Bilan du mois (30 derniers jours)</h2><div class="carte">${htmlBilan(calculer(Date.now() - 30 * JOUR), { detail: true })}</div>
    <button class="principal large" id="copier">📋 Copier un résumé pour Claude</button><p class="petit" id="copie-msg"></p>
    <button class="large" id="export">⬇️ Exporter mes données (JSON)</button>
    <h2>Bilans archivés</h2>
    ${archives.length ? archives.map(a => `<details class="carte"><summary>${a.type === 'mois' ? '🗓️' : '📅'} ${h(a.titre)}</summary>${htmlBilan(a.bilan, { detail: a.type === 'mois' })}</details>`).join('')
      : '<p class="petit">Le bilan de chaque semaine et de chaque mois terminés sera rangé ici automatiquement.</p>'}`);
  document.getElementById('export').onclick = exporter;
  document.getElementById('copier').onclick = async () => {
    const texte = resumePourClaude(), msg = document.getElementById('copie-msg');
    try { await navigator.clipboard.writeText(texte); msg.textContent = 'Résumé copié. Colle-le dans une conversation avec Claude.'; }
    catch (e) { msg.innerHTML = 'Copie automatique impossible. Sélectionne et copie ce texte :<textarea style="min-height:200px"></textarea>'; msg.querySelector('textarea').value = texte; }
  };
}

// ---------- Réglages ----------
async function texteSuivi() {
  const url = await urlSuivi(), dernier = await etatSuivi(), attente = await enAttente();
  if (!url) return 'Suivi désactivé.';
  const quand = dernier ? new Date(dernier.t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
  return (dernier ? `Dernier envoi le ${quand} : ${dernier.ok ? '✅ réussi' : '❌ échec (' + dernier.erreur + ')'}.` : 'Aucun envoi pour l’instant.')
    + ` ${attente} réponse${attente > 1 ? 's' : ''} en attente.`;
}

async function ecranReglages(messageSuivi = '') {
  const url = await urlSuivi(), etatTexte = messageSuivi || await texteSuivi();
  const options = (liste, courant) => liste.map(([v, t]) => `<option value="${h(v)}" ${String(v) === String(courant) ? 'selected' : ''}>${h(t)}</option>`).join('');
  page(`<h1>Réglages</h1>
    <h2>Voix</h2>
    <label>Accent par défaut<select id="accent">${options(Object.entries(ACCENTS), reglages.accent)}</select></label>
    <p></p><label>Vitesse<select id="vitesse">${options([0.8, 0.9, 1, 1.1, 1.2, 1.3].map(v => [v, String(v).replace('.', ',') + '×']), reglages.vitesse)}</select></label>
    <h3>Voix installées sur cet appareil</h3>
    ${aSynthese ? Object.entries(ACCENTS).map(([code, nom]) => {
      const l = voixPour(code);
      return `<p><b>${nom}</b> : ${l.length ? `${l.length} voix` : '❌ aucune'}
        ${l.length > 1 ? `<select data-voix="${code}">${options(l.map(v => [v.voiceURI, v.name]), reglages.voix[code])}</select>` : ''}
        ${l.length ? `<button data-test="${code}" style="min-height:40px">▶ Tester</button>` : ''}</p>`;
    }).join('') + `<p class="petit">${nbVoix()} voix détectées au total.</p>` : '<p>La synthèse vocale n\'est pas disponible sur ce navigateur.</p>'}
    <details class="carte" ${voixPour('en-IN').length ? '' : 'open'}><summary>Installer une voix à accent indien</summary>
      <p><b>Android (Samsung)</b> : Paramètres → Gestion globale → Synthèse vocale. Choisis le moteur « Services de synthèse vocale Google », touche la roue dentée → Installer les données vocales → English (India), puis télécharge une voix. Ferme et rouvre l'application.</p>
      <p><b>iPhone</b> : Réglages → Accessibilité → Contenu énoncé → Voix → Anglais → Anglais (Inde), puis télécharge une voix.</p>
      <p class="petit">Les noms de menus changent un peu selon la version du téléphone.</p></details>
    <p class="petit">Reconnaissance vocale : ${aReco ? '✅ disponible (elle a besoin d\'une connexion)' : '❌ indisponible sur ce navigateur, l\'oral passe en auto-évaluation'}.</p>
    <h2>Correction de l'écrit</h2>
    <label>Orthographe attendue<select id="lt">${options([['en-GB', 'Britannique (colour) — celle de l\'Inde'], ['en-US', 'Américaine (color)']], reglages.langueCorrection)}</select></label>
    <p class="petit">La correction envoie ton texte à LanguageTool, un service tiers gratuit.</p>
    <h2>Suivi automatique par Claude</h2>
    <p class="petit">Après chaque séance, tes réponses (textes compris) partent dans ton Google Sheets privé « English Coach (suivi) ». Chaque soir à 21 h, Claude les lit, t'envoie un bilan par mail et ajoute des exercices sur tes points faibles.</p>
    <input type="text" id="suivi-url" placeholder="https://script.google.com/macros/s/…/exec?k=…" inputmode="url" autocomplete="off" autocapitalize="none" spellcheck="false" value="${h(url)}">
    <button class="principal large" id="suivi-ok">Enregistrer et tester</button>
    ${url ? '<div class="rangee"><button id="suivi-envoi">Envoyer maintenant</button><button id="suivi-stop">Arrêter le suivi</button></div>' : ''}
    <p class="petit" id="suivi-etat">${h(etatTexte)}</p>
    <h2>Mes données</h2>
    <p class="petit">Tout est stocké sur ce téléphone. Exporte de temps en temps pour ne rien perdre.</p>
    <button class="large" id="export">⬇️ Exporter mes données (JSON)</button>
    <label class="bouton large">⬆️ Importer une sauvegarde<input type="file" id="import" accept="application/json,.json" hidden></label>
    <a class="bouton large" href="#/positionnement">Refaire le test de positionnement</a>
    <button class="large" id="effacer">🗑️ Tout effacer</button><p class="petit" id="msg"></p>`);
  const sauver = () => { reglages.accent = document.getElementById('accent').value; reglages.vitesse = Number(document.getElementById('vitesse').value); reglages.langueCorrection = document.getElementById('lt').value; sauverReglages(); };
  ['accent', 'vitesse', 'lt'].forEach(id => { document.getElementById(id).onchange = sauver; });
  ecran.querySelectorAll('[data-voix]').forEach(s => { s.onchange = () => { reglages.voix[s.dataset.voix] = s.value; sauverReglages(); }; });
  clic('[data-test]', e => dire('Hello, could you please share the updated drawing before our call tomorrow?', { accent: e.currentTarget.dataset.test }));
  document.getElementById('export').onclick = exporter;
  const msg = document.getElementById('msg');
  document.getElementById('import').onchange = async e => {
    try { await importer(await e.target.files[0].text()); location.reload(); } catch (err) { msg.textContent = 'Import impossible : ' + err.message; }
  };
  const etatEl = document.getElementById('suivi-etat');
  // Un envoi peut être en cours (lancé à l'ouverture de l'écran) : on rafraîchit l'état quand il se termine.
  if (url && !messageSuivi) synchroniser().then(async () => { if (document.body.contains(etatEl)) etatEl.textContent = await texteSuivi(); });
  document.getElementById('suivi-ok').onclick = () => activerSuivi(document.getElementById('suivi-url').value.trim(), etatEl);
  if (url) {
    document.getElementById('suivi-envoi').onclick = async () => {
      etatEl.textContent = 'Envoi en cours…';
      const r = await synchroniser();
      etatEl.textContent = { ok: `✅ Envoyé (${r.ajoutees} nouvelle${r.ajoutees > 1 ? 's' : ''} réponse${r.ajoutees > 1 ? 's' : ''} dans le tableau).`, ajour: '✅ Tout est déjà envoyé.', horsligne: 'Pas de connexion : l’envoi se fera plus tard.', erreur: '❌ Échec : ' + r.erreur }[r.statut] || '';
    };
    document.getElementById('suivi-stop').onclick = async () => { await definirUrl(''); ecranReglages('Suivi arrêté. Tes résultats restent sur le téléphone.'); };
  }
  let confirme = false;
  document.getElementById('effacer').onclick = async e => {
    if (!confirme) { confirme = true; e.currentTarget.textContent = '⚠️ Touche encore une fois pour tout effacer'; return; }
    await toutEffacer(); location.hash = '#/accueil'; location.reload();
  };
}

async function activerSuivi(u, etatEl) {
  if (!adresseValide(u)) { etatEl.textContent = '❌ Cette adresse ne ressemble pas à celle du script (elle doit commencer par https://script.google.com/macros/s/ et finir par ?k=…).'; return; }
  etatEl.textContent = 'Test de la connexion…';
  try { await tester(u); } catch (e) { etatEl.textContent = '❌ Le script ne répond pas correctement : ' + e.message; return; }
  await definirUrl(u);
  const r = await synchroniser();
  await ecranReglages(r.statut === 'erreur' ? '✅ Connexion réussie, mais l’envoi a échoué : ' + r.erreur : `✅ Suivi activé. ${r.ajoutees ? r.ajoutees + ' réponse' + (r.ajoutees > 1 ? 's' : '') + ' envoyée' + (r.ajoutees > 1 ? 's' : '') + '.' : ''}`);
}

// Lien de configuration reçu par mail : #/config?suivi=<adresse encodée>
async function configurer(params) {
  history.replaceState(null, '', '#/reglages');
  document.querySelectorAll('#onglets a').forEach(a => a.classList.toggle('actif', a.dataset.tab === 'reglages'));
  await ecranReglages('Configuration du suivi…');
  await activerSuivi(params.get('suivi') || '', document.getElementById('suivi-etat'));
}

// ---------- Navigation ----------
const SEANCES = {
  jour: () => seance(null, 'Séance du jour', 8),
  ce: () => seance('ce', COMPETENCES.ce, 4), co: () => seance('co', COMPETENCES.co, 6),
  ee: () => seance('ee', COMPETENCES.ee, 6), eo: () => seance('eo', COMPETENCES.eo, 6),
  dictee: () => seance('co', 'Dictée', 6, e => e.type === 'dictee'),
  vocab: () => seance('voc', 'Vocabulaire technique', 10),
  indien: () => seance('ind', 'Quiz anglais indien', 8)
};

function router() {
  arreter();
  seanceEnCours = null;
  document.body.classList.remove('en-seance');
  synchroniser();
  if (location.hash.startsWith('#/config?')) { configurer(new URLSearchParams(location.hash.slice(9))); return; }
  const [, route = 'accueil', arg] = location.hash.split('/');
  document.querySelectorAll('#onglets a').forEach(a => a.classList.toggle('actif', a.dataset.tab === route));
  const ecrans = { accueil, entrainement, indien, bilans, reglages: ecranReglages, positionnement: ecranPositionnement, carnet, liens, seance: () => (SEANCES[arg] || SEANCES.jour)() };
  (ecrans[route] || accueil)();
}

async function demarrer() {
  try {
    await charger();
    await initVoix();
    await archiver();
  } catch (e) {
    page(`<h1>English Coach</h1><div class="alerte">L'application n'a pas pu démarrer : ${h(e.message)}</div>`);
    console.error(e);
    return;
  }
  window.addEventListener('hashchange', router);
  window.addEventListener('online', () => synchroniser());
  router();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker non installé', e));
}

demarrer();
