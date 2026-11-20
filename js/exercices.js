// Affichage et correction de chaque type d'exercice.
// afficher(ex, zone) renvoie une promesse : { resultats: [{ ok, cats, detail }], accent }.
import { ACCENTS, reglages, sauverReglages, aSynthese, aReco, aMicro, voixPour, dire, arreter, ecouter, enregistrer, comparer, memePhrase } from './voix.js';
import { corriger } from './correction.js';

export const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

const SEUIL_DICTEE = 0.9, SEUIL_ORAL = 0.85, SEUIL_GRILLE = 0.75;

export function afficher(ex, zone) {
  return new Promise(resoudre => {
    const rendu = { qcm, dictee, correction, redaction, dire: direPhrase, shadow, situation, vocab }[ex.type];
    let accent = '';
    const fin = (resultats, retourHtml) => {
      zone.querySelectorAll('[data-avant]').forEach(b => { b.disabled = true; });
      const bons = resultats.filter(r => r.ok).length, tout = bons === resultats.length;
      zone.append(el(`<div class="retour ${tout ? 'bon' : 'faux'}"><b>${tout ? '✅ Réussi' : bons ? '🟠 En partie réussi' : '❌ À revoir'}</b>${retourHtml || ''}</div>`));
      const suite = el('<button class="principal large">Suivant</button>');
      suite.onclick = () => { arreter(); resoudre({ resultats, accent }); };
      zone.append(suite);
      suite.scrollIntoView({ block: 'nearest' });
    };
    rendu(ex, zone, fin, a => { accent = a; });
  });
}

// Bloc d'écoute : accent, vitesse, et transcription visible seulement après la première écoute.
function blocAudio(zone, texte, noterAccent, { transcription = true } = {}) {
  if (!aSynthese) {
    zone.append(el(`<div class="alerte">La synthèse vocale n'est pas disponible sur ce navigateur. Voici le texte :<p>${h(texte)}</p></div>`));
    return;
  }
  const accents = Object.entries(ACCENTS).map(([code, nom]) =>
    `<option value="${code}" ${code === reglages.accent ? 'selected' : ''}>${nom}${voixPour(code).length ? '' : ' (voix absente)'}</option>`).join('');
  const vitesses = [0.8, 0.9, 1, 1.1, 1.2, 1.3].map(v =>
    `<option value="${v}" ${v === reglages.vitesse ? 'selected' : ''}>${String(v).replace('.', ',')}×</option>`).join('');
  const bloc = el(`<div class="carte">
    <div class="rangee"><button class="principal" data-a="jouer">▶ Écouter</button><button data-a="stop" aria-label="Arrêter">■ Stop</button></div>
    <div class="rangee"><select data-a="accent" aria-label="Accent">${accents}</select><select data-a="vitesse" aria-label="Vitesse">${vitesses}</select></div>
    ${transcription ? '<button data-a="voir" class="large" disabled>Voir la transcription (après une écoute)</button><p data-a="texte" class="texte-lecture" hidden></p>' : ''}
  </div>`);
  const q = a => bloc.querySelector(`[data-a="${a}"]`);
  noterAccent(q('accent').value);
  q('jouer').onclick = async () => {
    noterAccent(q('accent').value);
    const fini = await dire(texte, { accent: q('accent').value, vitesse: Number(q('vitesse').value) });
    if (fini && transcription) q('voir').disabled = false;
  };
  q('stop').onclick = arreter;
  q('vitesse').onchange = () => { reglages.vitesse = Number(q('vitesse').value); sauverReglages(); };
  if (transcription) q('voir').onclick = () => { q('texte').textContent = texte; q('texte').hidden = false; };
  zone.append(bloc);
}

const marquer = marques => marques.map(m => `<span class="${m.ok ? 'mot-ok' : 'mot-ko'}">${h(m.mot)}</span>`).join(' ');

function grille(points) {
  return `<h3>Auto-évaluation</h3>` + points.map((p, i) => `<label class="option"><input type="checkbox" data-grille="${i}"><span>${h(p)}</span></label>`).join('');
}
const noteGrille = zone => { const c = [...zone.querySelectorAll('[data-grille]')]; return c.length ? c.filter(x => x.checked).length / c.length : 1; };

// ---- QCM (lecture, écoute, quiz) ----
function qcm(ex, zone, fin, noterAccent) {
  if (ex.text) zone.append(el(`<div class="texte-lecture">${h(ex.text)}</div>`));
  if (ex.audio) blocAudio(zone, ex.audio, noterAccent);
  ex.questions.forEach((q, i) => {
    zone.append(el(`<fieldset class="carte" style="border-width:1px" data-q="${i}"><legend class="petit">Question ${i + 1} sur ${ex.questions.length}</legend>
      <p style="white-space:pre-line"><b>${h(q.q)}</b></p>
      ${q.options.map((o, k) => `<label class="option"><input type="radio" name="q${i}" value="${k}"><span>${h(o)}</span></label>`).join('')}
    </fieldset>`));
  });
  const valider = el('<button class="principal large" data-avant>Valider</button>');
  const msg = el('<p class="petit" hidden>Réponds à toutes les questions avant de valider.</p>');
  zone.append(msg, valider);
  valider.onclick = () => {
    const choix = ex.questions.map((q, i) => zone.querySelector(`input[name=q${i}]:checked`));
    if (choix.some(c => !c)) { msg.hidden = false; return; }
    msg.hidden = true;
    const resultats = ex.questions.map((q, i) => {
      const k = Number(choix[i].value), ok = k === q.answer;
      const options = zone.querySelectorAll(`[data-q="${i}"] label`);
      options[q.answer].classList.add('bon');
      if (!ok) options[k].classList.add('faux');
      if (q.why) zone.querySelector(`[data-q="${i}"]`).append(el(`<p class="petit">${h(q.why)}</p>`));
      zone.querySelectorAll(`input[name=q${i}]`).forEach(r => { r.disabled = true; });
      return { ok, cats: [q.cat], detail: ok ? '' : `${q.q.split('\n')[0]} — bonne réponse : « ${q.options[q.answer]} » ; ta réponse : « ${q.options[k]} »` };
    });
    fin(resultats);
  };
}

// ---- Dictée ----
function dictee(ex, zone, fin, noterAccent) {
  zone.append(el('<p>Écoute la phrase, puis écris exactement ce que tu entends.</p>'));
  blocAudio(zone, ex.audio, noterAccent, { transcription: false });
  const saisie = el('<textarea data-avant autocapitalize="sentences" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Écris ici…"></textarea>');
  const valider = el('<button class="principal large" data-avant>Valider</button>');
  zone.append(saisie, valider);
  valider.onclick = () => {
    if (!saisie.value.trim()) return;
    const c = comparer(ex.audio, saisie.value), ok = c.ratio >= SEUIL_DICTEE;
    fin([{ ok, cats: ex.cats || ['dictee'], texte: saisie.value, detail: ok ? '' : `Dictée : « ${ex.audio} » — mots manqués : ${c.rates.join(', ')}` }],
      `<p>${marquer(c.marques)}</p><p class="petit">${Math.round(c.ratio * 100)} % des mots retrouvés (il en faut ${SEUIL_DICTEE * 100} %).</p>`);
  };
}

// ---- Phrase à corriger ----
function correction(ex, zone, fin) {
  zone.append(el(`<p>Cette phrase contient une erreur. Corrige-la.</p>`), el(`<p class="texte-lecture">${h(ex.wrong)}</p>`));
  const saisie = el('<textarea data-avant style="min-height:84px" autocomplete="off" autocorrect="off" spellcheck="false"></textarea>');
  saisie.value = ex.wrong;
  const valider = el('<button class="principal large" data-avant>Valider</button>');
  zone.append(saisie, valider);
  valider.onclick = () => {
    const ok = ex.answers.some(a => memePhrase(a, saisie.value));
    fin([{ ok, cats: ex.cats, texte: saisie.value, detail: ok ? '' : `« ${ex.wrong} » → « ${ex.answers[0]} » (ta réponse : « ${saisie.value.trim()} »)` }],
      `<p>Correction : <b>${h(ex.answers[0])}</b></p><p class="petit">${h(ex.explain || '')}</p>`);
  };
}

// ---- Rédaction (LanguageTool + corrigé modèle + auto-évaluation) ----
function redaction(ex, zone, fin) {
  zone.append(el(`<div class="texte-lecture">${h(ex.prompt)}</div>`));
  const saisie = el(`<textarea data-avant style="min-height:180px" placeholder="Écris ta réponse en anglais (${ex.min || 40} mots au moins)…"></textarea>`);
  const compteur = el('<p class="petit">0 mot</p>');
  const info = el('<p class="petit">🔒 Le bouton « Corriger » envoie ton texte à LanguageTool, un service tiers gratuit en ligne. N\'y mets rien de confidentiel.</p>');
  const btnCorriger = el('<button class="principal large" data-avant>Corriger avec LanguageTool</button>');
  const btnSans = el('<button class="large" data-avant>Continuer sans correction en ligne</button>');
  const suite = el('<div></div>');
  zone.append(saisie, compteur, info, btnCorriger, btnSans, suite);
  const nbMots = () => saisie.value.trim().split(/\s+/).filter(Boolean).length;
  saisie.oninput = () => { const n = nbMots(); compteur.textContent = `${n} mot${n > 1 ? 's' : ''}`; };

  const phase2 = (rep) => {
    btnCorriger.disabled = btnSans.disabled = true;
    let html = '';
    if (rep && rep.statut === 'ok') {
      html += rep.fautes.length
        ? `<h3>${rep.fautes.length} remarque${rep.fautes.length > 1 ? 's' : ''} de LanguageTool</h3>` + rep.fautes.map(f =>
          `<div class="carte"><span class="mot-ko">${h(f.extrait)}</span>${f.propositions.length ? ' → <b>' + h(f.propositions.join(' / ')) + '</b>' : ''}<p class="petit">${h(f.message)}</p></div>`).join('')
        : '<p>LanguageTool n\'a trouvé aucune faute. Il ne juge ni le ton ni la clarté : compare avec le modèle.</p>';
    } else if (rep) {
      html += `<div class="alerte">${{ horsligne: 'Pas de connexion : la correction en ligne est sautée.', limite: 'Trop de demandes rapprochées : attends quelques secondes avant la prochaine correction.', erreur: 'LanguageTool n\'a pas répondu.' }[rep.statut]} Utilise le modèle et la grille ci-dessous.</div>`;
    }
    html += `<h3>Corrigé modèle</h3><div class="texte-lecture">${h(ex.model)}</div>${grille(ex.checklist)}`;
    suite.innerHTML = html;
    const terminer = el('<button class="principal large" data-avant>Terminer</button>');
    suite.append(terminer);
    terminer.onclick = () => {
      const note = noteGrille(suite), ok = note >= SEUIL_GRILLE;
      const resultats = [{ ok, cats: ex.cats, texte: saisie.value, detail: ok ? '' : `Rédaction « ${ex.prompt.slice(0, 60)}… » : grille remplie à ${Math.round(note * 100)} %` }];
      if (rep && rep.statut === 'ok') {
        const parCat = {};
        for (const f of rep.fautes) if (f.cat) (parCat[f.cat] = parCat[f.cat] || []).push(f);
        for (const c of ['ortho', 'grammaire']) if (!parCat[c]) resultats.push({ ok: true, cats: [c] });
        for (const [c, fs] of Object.entries(parCat)) for (const f of fs.slice(0, 2))
          resultats.push({ ok: false, cats: [c], detail: `« ${f.extrait} »${f.propositions[0] ? ' → « ' + f.propositions[0] + ' »' : ''} — ${f.message}` });
      }
      fin(resultats);
    };
  };

  btnCorriger.onclick = async () => {
    if (nbMots() < 10) { compteur.textContent = 'Écris au moins 10 mots avant de faire corriger.'; return; }
    btnCorriger.disabled = true; btnCorriger.textContent = 'Correction en cours…';
    phase2(await corriger(saisie.value));
  };
  btnSans.onclick = () => { if (nbMots() < 10) { compteur.textContent = 'Écris au moins 10 mots.'; return; } phase2(null); };
}

// ---- Dire une phrase (reconnaissance vocale) ----
function direPhrase(ex, zone, fin, noterAccent) {
  zone.append(el('<p>Dis cette phrase à voix haute :</p>'));
  const cible = el(`<p class="texte-lecture" style="font-size:1.15rem">${h(ex.target)}</p>`);
  const modele = el('<button data-avant>▶ Écouter le modèle</button>');
  const parler = el('<button class="principal" data-avant>🎤 Parler</button>');
  const entendu = el('<p class="petit"></p>');
  const valider = el('<button class="principal large" data-avant disabled>Valider</button>');
  const rangee = el('<div class="rangee"></div>');
  rangee.append(modele, parler);
  zone.append(cible, rangee, entendu, valider);
  modele.onclick = () => { noterAccent(reglages.accent); dire(ex.target); };

  const autoEval = raison => {
    parler.disabled = true; valider.hidden = true;
    entendu.textContent = raison + ' Dis la phrase, compare avec le modèle, puis évalue-toi.';
    const oui = el('<button data-avant>👍 Bien prononcée</button>'), non = el('<button data-avant>👎 À retravailler</button>');
    const r = el('<div class="rangee"></div>'); r.append(oui, non); zone.append(r);
    oui.onclick = () => fin([{ ok: true, cats: ex.cats }]);
    non.onclick = () => fin([{ ok: false, cats: ex.cats, detail: `À l'oral : « ${ex.target} » (auto-évaluation)` }]);
  };
  if (!aReco) { autoEval('La reconnaissance vocale n\'est pas disponible sur ce navigateur.'); return; }

  let meilleur = null;
  parler.onclick = async () => {
    arreter();
    parler.disabled = true; parler.textContent = '🎤 J\'écoute…';
    try {
      const pistes = await ecouter().resultat;
      if (!pistes.length) entendu.textContent = 'Je n\'ai rien entendu. Réessaie en parlant près du micro.';
      for (const p of pistes) {
        const c = comparer(ex.target, p);
        if (!meilleur || c.ratio > meilleur.c.ratio) meilleur = { c, texte: p };
      }
      if (meilleur) {
        cible.innerHTML = marquer(meilleur.c.marques);
        entendu.textContent = `Compris : « ${meilleur.texte} » (${Math.round(meilleur.c.ratio * 100)} %). Tu peux réessayer avant de valider.`;
        valider.disabled = false;
      }
    } catch (e) {
      autoEval(`Le micro ou la reconnaissance vocale a échoué (${e.message}).`);
      return;
    }
    parler.disabled = false; parler.textContent = '🎤 Réessayer';
  };
  valider.onclick = () => {
    const ok = meilleur.c.ratio >= SEUIL_ORAL;
    const viseFocus = (ex.focus || []).some(m => meilleur.c.rates.includes(m.toLowerCase()));
    fin([{ ok, cats: ok || viseFocus ? ex.cats : ['prononciation'], texte: meilleur.texte, detail: ok ? '' : `À l'oral : « ${ex.target} » — compris : « ${meilleur.texte} »` }],
      ex.tip ? `<p class="petit">${h(ex.tip)}</p>` : '');
  };
}

// Bouton d'enregistrement et de réécoute de sa propre voix.
function blocEnregistrement(zone) {
  if (!aMicro) { zone.append(el('<p class="petit">L\'enregistrement n\'est pas disponible sur ce navigateur : répète à voix haute sans t\'enregistrer.</p>')); return; }
  const bouton = el('<button class="large" data-avant>⏺ M\'enregistrer</button>');
  const lecteur = el('<audio controls hidden style="width:100%;margin:8px 0"></audio>');
  let prise = null;
  bouton.onclick = async () => {
    try {
      if (!prise) { arreter(); prise = await enregistrer(); bouton.textContent = '⏹ Arrêter l\'enregistrement'; }
      else { lecteur.src = await prise.stop(); lecteur.hidden = false; prise = null; bouton.textContent = '⏺ Recommencer l\'enregistrement'; }
    } catch (e) { bouton.textContent = 'Micro refusé ou indisponible'; bouton.disabled = true; }
  };
  zone.append(bouton, lecteur);
}

// ---- Shadowing : écouter, répéter, s'enregistrer, comparer ----
function shadow(ex, zone, fin, noterAccent) {
  zone.append(el('<p><b>Shadowing.</b> Écoute la phrase, répète-la en imitant le rythme, enregistre-toi, puis compare.</p>'));
  blocAudio(zone, ex.audio, noterAccent);
  blocEnregistrement(zone);
  if (ex.tip) zone.append(el(`<p class="petit">💡 ${h(ex.tip)}</p>`));
  zone.append(el('<h3>Comment était ta version ?</h3>'));
  const r = el('<div class="rangee"></div>');
  [['👍 Fidèle', true], ['👌 Correcte', true], ['👎 À retravailler', false]].forEach(([t, ok]) => {
    const b = el(`<button data-avant>${t}</button>`);
    b.onclick = () => fin([{ ok, cats: ex.cats, detail: ok ? '' : `Shadowing à retravailler : « ${ex.audio} »` }]);
    r.append(b);
  });
  zone.append(r);
}

// ---- Mise en situation orale ----
function situation(ex, zone, fin) {
  zone.append(el(`<div class="texte-lecture">${h(ex.prompt)}</div>`));
  if (ex.hints) zone.append(el(`<details><summary>Phrases utiles</summary><ul>${ex.hints.map(x => `<li>${h(x)}</li>`).join('')}</ul></details>`));
  const texte = el('<p class="texte-lecture" hidden></p>');
  if (aReco) {
    const parler = el('<button class="principal large" data-avant>🎤 Répondre à l\'oral</button>');
    let ecoute = null;
    parler.onclick = async () => {
      if (ecoute) { ecoute.stop(); return; }
      arreter(); texte.hidden = false; texte.textContent = '…';
      ecoute = ecouter({ continu: true, surTexte: t => { texte.textContent = t; } });
      parler.textContent = '⏹ J\'ai fini';
      try { const [t] = await ecoute.resultat; if (t) texte.textContent = t; } catch (e) { texte.textContent = 'La reconnaissance vocale a échoué : réponds à voix haute, puis compare avec le modèle.'; }
      ecoute = null; parler.textContent = '🎤 Recommencer';
    };
    zone.append(parler, texte);
  } else {
    zone.append(el('<p class="petit">Réponds à voix haute (tu peux t\'enregistrer), puis compare avec le modèle.</p>'));
    blocEnregistrement(zone);
  }
  const voir = el('<button class="large" data-avant>Voir un modèle de réponse</button>');
  const suite = el('<div></div>');
  zone.append(voir, suite);
  voir.onclick = () => {
    voir.disabled = true;
    suite.innerHTML = `<h3>Modèle</h3><div class="texte-lecture">${h(ex.model)}</div>`;
    const jouer = el('<button data-avant>▶ Écouter le modèle</button>');
    jouer.onclick = () => dire(ex.model);
    suite.append(jouer, el(`<div>${grille(ex.checklist)}</div>`));
    const terminer = el('<button class="principal large" data-avant>Terminer</button>');
    suite.append(terminer);
    terminer.onclick = () => {
      const note = noteGrille(suite), ok = note >= SEUIL_GRILLE;
      const dit = aReco && !texte.hidden && texte.textContent !== '…' ? texte.textContent : '';
      fin([{ ok, cats: ex.cats, texte: dit, detail: ok ? '' : `Mise en situation « ${ex.prompt.slice(0, 60)}… » : grille remplie à ${Math.round(note * 100)} %` }]);
    };
  };
}

// ---- Vocabulaire technique ----
function vocab(ex, zone, fin) {
  zone.append(el('<p>Comment dit-on en anglais ?</p>'), el(`<p class="texte-lecture" style="font-size:1.15rem"><b>${h(ex.fr)}</b></p>`));
  const saisie = el('<input type="text" data-avant autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="En anglais…">');
  const valider = el('<button class="principal large" data-avant>Valider</button>');
  zone.append(saisie, valider);
  const go = () => {
    const ok = ex.en.some(a => memePhrase(a, saisie.value));
    fin([{ ok, cats: ['vocab'], detail: ok ? '' : `${ex.fr} = ${ex.en[0]} (ta réponse : « ${saisie.value.trim()} »)` }],
      `<p><b>${h(ex.en.join(' / '))}</b></p><p class="petit">${h(ex.ex)}</p>`);
    dire(ex.en[0]);
  };
  valider.onclick = go;
  saisie.onkeydown = e => { if (e.key === 'Enter' && !valider.disabled) go(); };
}
