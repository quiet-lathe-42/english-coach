// Accès à IndexedDB : toutes les données restent sur le téléphone.
// Magasins : tentatives (une ligne par réponse), revisions (boîtes Leitner), kv (niveaux, réglages, bilans, liens).
const NOM = 'english-coach';
let ouverture;

function ouvrir() {
  if (!ouverture) {
    ouverture = new Promise((ok, ko) => {
      const r = indexedDB.open(NOM, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('tentatives', { keyPath: 'id', autoIncrement: true });
        d.createObjectStore('revisions', { keyPath: 'exId' });
        d.createObjectStore('kv');
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
  }
  return ouverture;
}

function tx(magasin, mode, action) {
  return ouvrir().then(d => new Promise((ok, ko) => {
    const t = d.transaction(magasin, mode);
    const req = action(t.objectStore(magasin));
    t.oncomplete = () => ok(req && req.result);
    t.onerror = () => ko(t.error);
    t.onabort = () => ko(t.error);
  }));
}

export const db = {
  add: (m, v) => tx(m, 'readwrite', o => o.add(v)),
  put: (m, v, cle) => tx(m, 'readwrite', o => cle === undefined ? o.put(v) : o.put(v, cle)),
  get: (m, cle) => tx(m, 'readonly', o => o.get(cle)),
  all: m => tx(m, 'readonly', o => o.getAll()),
  del: (m, cle) => tx(m, 'readwrite', o => o.delete(cle)),
  clear: m => tx(m, 'readwrite', o => o.clear())
};

export const kv = {
  async get(cle, defaut) { const v = await db.get('kv', cle); return v === undefined ? defaut : v; },
  set: (cle, v) => db.put('kv', v, cle)
};
