// ---- UI state helpers ----
function iterAllGridHandles() {
  const out = [];
  if (window.grids)      for (const [id, h] of window.grids.entries())      out.push([id, h]);
  if (window.sheetGrids) for (const [id, h] of window.sheetGrids.entries()) out.push([id, h]);
  return out;
}

export function captureUiStateFromGrids() {
  const res = { selections: {}, scroll: {} };
  if (!window.grids) return res;
  for (const [gridId, h] of iterAllGridHandles()) {
    try {
      const api = h.api;
      const uuids = (api.getSelectedRows?.() || [])
        .map(r => r?.__uuid)
        .filter(Boolean);
      res.selections[gridId] = uuids;

      const vp = h.el.querySelector('.ag-body-viewport');
      res.scroll[gridId] = vp ? vp.scrollTop || 0 : 0;
    } catch {}
  }

  return res;
}

export function restoreUiStateToGrids(ui, { align='middle' } = {}) {
  if (!ui || !window.grids) return;
  const { selections = {}, scroll = {} } = ui;

  for (const [gridId, h] of iterAllGridHandles()) {
    try {
      const api = h.api;

      // Sélections
      const want = selections[gridId] || [];
      if (want.length) {
        api.deselectAll?.();
        api.forEachNode?.(node => {
          const id = node.data?.__uuid;
          if (id && want.includes(id)) node.setSelected?.(true, false);
        });
        const node = api.getSelectedNodes?.()?.[0];
        if (node) api.ensureIndexVisible?.(node.rowIndex, align);
      }

      // Scroll
      const top = scroll[gridId];
      if (typeof top === 'number') {
        const vp = h.el.querySelector('.ag-body-viewport');
        if (vp) vp.scrollTop = top;
      }
    } catch {}
  }
}

// export function captureUiStateFromGrids() {
//   const out = [];
//   for (const [gridId, h] of iterAllGridHandles()) {
//     const api = h?.api;
//     const el  = h?.el;
//     if (!api || !el) continue;
//     const sel = (api.getSelectedRows?.() || [])[0]?.__uuid ?? null;
//     const vp  = el.querySelector?.('.ag-center-cols-viewport');
//     const scrollTop = vp?.scrollTop ?? 0;
//     out.push({ gridId, uuid: sel, scrollTop });
//   }
//   return out;
// }

// export async function restoreUiStateToGrids(state) {
//   if (!Array.isArray(state)) return;
//   for (const s of state) {
//     // récupère depuis grids OU sheetGrids
//     const h = window.grids?.get(s.gridId) || window.sheetGrids?.get(s.gridId);
//     const api = h?.api;
//     const el  = h?.el;
//     if (!api || !el) continue;

//     // reselect
//     if (s.uuid) {
//       let node = null;
//       api.forEachNode?.(n => { if (!node && n.data?.__uuid === s.uuid) node = n; });
//       node?.setSelected?.(true, true);
//     }

//     // scroll
//     const vp = el.querySelector?.('.ag-center-cols-viewport');
//     if (vp && Number.isFinite(s.scrollTop)) vp.scrollTop = s.scrollTop;
//   }
// }

