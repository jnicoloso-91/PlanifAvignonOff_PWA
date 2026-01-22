// ---- UI state helpers ----
function iterAllGridHandles() {
  const out = [];
  if (window.grids)      for (const [id, h] of window.grids.entries())      out.push([id, h]);
  if (window.sheetGrids) for (const [id, h] of window.sheetGrids.entries()) out.push([id, h]);
  return out;
}

export function captureUiStateFromGrids() {
  const res = { selections: {}, scroll: {}, columnState: {} };
  if (!window.grids) return res;
  for (const [gridId, h] of iterAllGridHandles()) {
    try {
      const api = h.api;

      // Filters
      const uuids = (api.getSelectedRows?.() || [])
        .map(r => r?.__uuid)
        .filter(Boolean);
      res.selections[gridId] = uuids;

      // Scroll
      const vp = h.el.querySelector('.ag-body-viewport');
      res.scroll[gridId] = vp ? vp.scrollTop || 0 : 0;

      // Sort/columns state
      if (api.getColumnState) {
        res.columnState[gridId] = api.getColumnState();
      } else if (api.getColumnDefs) {
        // fallback “cheap”: rien (on évite d’inventer)
        res.columnState[gridId] = null;
      }      
    } catch {}
  }

  return res;
}

export function restoreUiStateToGrids(ui, { align='middle' } = {}) {
  if (!ui || !window.grids) return;
  const { selections = {}, scroll = {}, columnState = {} } = ui;

  for (const [gridId, h] of iterAllGridHandles()) {
    try {
      const api = h.api;

      // Restore sort/columns d'abord
      const st = columnState?.[gridId];
      if (st && api.applyColumnState) {
        api.applyColumnState({
          state: st,
          applyOrder: true,         // respecte l'ordre si l'état le contient
        });
      }

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
