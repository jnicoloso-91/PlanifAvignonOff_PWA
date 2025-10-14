// carnet.js

/**
 * Trie un carnet d’adresses par la colonne Nom (ordre alphabétique FR, sans tenir compte des accents)
 * @param {Array<Object>} carnet - tableau d’objets avec au moins une clé 'Nom'
 * @returns {Array<Object>} un nouveau tableau trié (ne modifie pas l’original)
 */
export function sortCarnet(carnet = []) {
  if (!Array.isArray(carnet)) return [];

  // copie superficielle + tri
  return [...carnet].sort((a, b) => {
    const na = (a.Nom || '').toLocaleLowerCase();
    const nb = (b.Nom || '').toLocaleLowerCase();
    return na.localeCompare(nb, 'fr', { sensitivity: 'base' });
  });
}