// Correction de l'écrit avec l'API publique gratuite de LanguageTool.
// Attention : le texte est envoyé à un service tiers (languagetool.org).
import { reglages } from './voix.js';

const URL_LT = 'https://api.languagetool.org/v2/check';
const DELAI_MIN = 4000; // l'API gratuite limite le nombre de requêtes par minute
let dernierAppel = 0;

// Range une règle LanguageTool dans une de mes catégories (approximatif).
function categorie(regle) {
  const id = (regle.id || '').toUpperCase(), cat = ((regle.category && regle.category.id) || '').toUpperCase();
  if (cat === 'TYPOS' || cat === 'CASING' || cat === 'COMPOUNDING') return 'ortho';
  if (cat === 'FALSE_FRIENDS' || cat === 'CONFUSED_WORDS' || id.includes('FALSE_FRIEND')) return 'fauxamis';
  if (/(^|_)(A_|AN_|THE_|DT_|ARTICLE|DETERMINER)/.test(id) || id.includes('ARTICLE')) return 'art';
  if (id.includes('PREP')) return 'prep';
  if (id.includes('TENSE') || id.includes('VERB') || id.includes('PARTICIPLE') || id.includes('AGREEMENT')) return 'temps';
  if (id.includes('WORD_ORDER') || id.includes('ADVERB_ORDER')) return 'ordre';
  if (cat === 'STYLE' || cat === 'REDUNDANCY' || cat === 'PUNCTUATION' || cat === 'TYPOGRAPHY') return null; // non compté
  return 'grammaire';
}

// Renvoie { statut: 'ok' | 'horsligne' | 'limite' | 'erreur', fautes: [...] }
export async function corriger(texte) {
  if (!navigator.onLine) return { statut: 'horsligne', fautes: [] };
  if (Date.now() - dernierAppel < DELAI_MIN) return { statut: 'limite', fautes: [] };
  dernierAppel = Date.now();
  try {
    const r = await fetch(URL_LT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ text: texte, language: reglages.langueCorrection, motherTongue: 'fr' })
    });
    if (r.status === 429) return { statut: 'limite', fautes: [] };
    if (!r.ok) return { statut: 'erreur', fautes: [] };
    const j = await r.json();
    const fautes = j.matches.map(m => ({
      message: m.message,
      extrait: m.context.text.substr(m.context.offset, m.context.length),
      contexte: m.context.text,
      propositions: m.replacements.slice(0, 3).map(x => x.value),
      cat: categorie(m.rule)
    }));
    return { statut: 'ok', fautes };
  } catch (e) {
    return { statut: 'horsligne', fautes: [] };
  }
}
