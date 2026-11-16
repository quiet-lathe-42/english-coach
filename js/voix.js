// Synthèse vocale (accents), reconnaissance vocale, enregistrement et comparaison de phrases.
import { kv } from './db.js';

export const ACCENTS = { 'en-IN': 'Indien', 'en-US': 'Américain', 'en-GB': 'Britannique', 'en-AU': 'Australien' };
export const reglages = { accent: 'en-IN', vitesse: 1, voix: {}, langueCorrection: 'en-GB' };

export const aSynthese = 'speechSynthesis' in window;
const Reco = window.SpeechRecognition || window.webkitSpeechRecognition;
export const aReco = !!Reco;
export const aMicro = !!(navigator.mediaDevices && window.MediaRecorder);

let voix = [];
const lireVoix = () => { voix = aSynthese ? speechSynthesis.getVoices() : []; };

export async function initVoix() {
  Object.assign(reglages, await kv.get('reglages', {}));
  if (!aSynthese) return;
  lireVoix();
  speechSynthesis.addEventListener('voiceschanged', lireVoix);
  if (!voix.length) await new Promise(ok => { speechSynthesis.addEventListener('voiceschanged', ok, { once: true }); setTimeout(ok, 1500); });
  lireVoix();
}

export const sauverReglages = () => kv.set('reglages', { ...reglages });

const memeLangue = (v, langue) => v.lang.replace('_', '-').toLowerCase() === langue.toLowerCase();
export const voixPour = langue => voix.filter(v => memeLangue(v, langue));
export const nbVoix = () => voix.length;

function choisirVoix(langue) {
  const dispo = voixPour(langue);
  return dispo.find(v => v.voiceURI === reglages.voix[langue]) || dispo[0] || null;
}

let lectureEnCours = 0;
export function arreter() { lectureEnCours++; if (aSynthese) speechSynthesis.cancel(); }

// Lit un texte phrase par phrase (certaines voix coupent les longs passages).
export async function dire(texte, { accent = reglages.accent, vitesse = reglages.vitesse } = {}) {
  if (!aSynthese) return false;
  arreter();
  const moi = lectureEnCours;
  const v = choisirVoix(accent);
  const phrases = texte.match(/[^.!?\n]+[.!?]*/g) || [texte];
  for (const p of phrases) {
    if (moi !== lectureEnCours) return false;
    if (!p.trim()) continue;
    await new Promise(ok => {
      const u = new SpeechSynthesisUtterance(p.trim());
      u.lang = accent; if (v) u.voice = v; u.rate = vitesse;
      u.onend = ok; u.onerror = ok;
      speechSynthesis.speak(u);
    });
  }
  return moi === lectureEnCours;
}

// Écoute une prise de parole. Renvoie la liste des transcriptions possibles.
export function ecouter({ continu = false, surTexte = null } = {}) {
  const r = new Reco();
  r.lang = 'en-US'; r.maxAlternatives = 3; r.continuous = continu; r.interimResults = !!surTexte;
  const finals = [];
  const resultat = new Promise((ok, ko) => {
    r.onresult = e => {
      let provisoire = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finals.push([...res].map(a => a.transcript.trim()));
        else provisoire += res[0].transcript;
      }
      if (surTexte) surTexte(finals.map(f => f[0]).join(' ') + ' ' + provisoire);
    };
    r.onerror = e => { if (e.error !== 'no-speech' && e.error !== 'aborted') ko(new Error(e.error)); };
    r.onend = () => ok(continu ? [finals.map(f => f[0]).join(' ')] : (finals[0] || []));
  });
  r.start();
  return { stop: () => r.stop(), resultat };
}

export async function enregistrer() {
  const flux = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mr = new MediaRecorder(flux);
  const morceaux = [];
  mr.ondataavailable = e => morceaux.push(e.data);
  const fini = new Promise(ok => {
    mr.onstop = () => { flux.getTracks().forEach(p => p.stop()); ok(URL.createObjectURL(new Blob(morceaux, { type: mr.mimeType }))); };
  });
  mr.start();
  return { stop: () => { mr.stop(); return fini; } };
}

const CHIFFRES = { '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten', '11': 'eleven', '12': 'twelve' };
const normMot = m => { const s = m.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9']/g, '').replace(/^'+|'+$/g, ''); return CHIFFRES[s] || s; };
const mots = s => s.split(/[\s\-–—]+/).filter(m => normMot(m));

// Compare une phrase attendue à ce qui a été dit ou écrit (plus longue sous-suite commune de mots).
export function comparer(attendu, donne) {
  const A = mots(attendu), a = A.map(normMot), b = mots(donne || '').map(normMot);
  const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const marques = [];
  let i = 0, j = 0;
  while (i < a.length) {
    if (j < b.length && a[i] === b[j]) { marques.push({ mot: A[i], ok: true }); i++; j++; }
    else if (j < b.length && L[i][j + 1] >= L[i + 1][j]) j++;
    else { marques.push({ mot: A[i], ok: false }); i++; }
  }
  const bons = marques.filter(m => m.ok).length;
  return { ratio: a.length ? bons / a.length : 0, marques, rates: marques.filter(m => !m.ok).map(m => normMot(m.mot)) };
}

export const memePhrase = (x, y) => mots(x).map(normMot).join(' ') === mots(y).map(normMot).join(' ');
