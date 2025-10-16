// ---- UI state helpers ----
export function captureUiStateFromGrids() {
  const res = { selections: {}, scroll: {} };
  if (!window.grids) return res;
  for (const [gridId, h] of window.grids.entries()) {
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

  for (const [gridId, h] of window.grids.entries()) {
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

