export {};

declare global {
  const ctx: any;
  const XLSX: any;

  interface Window {
    pager: any;
    grids: any;
    ctx: any;
    XLSX: any;
    sheetGrids: any;
    agGrid: any;
    appState: any;
    __applyProgrammeCalHeight: any;
    _chipProgStyle?: { getValues: () => string[] };
    _chipProgMood?: { getValues: () => string[] };
    _chipProgPrio?: { getValues: () => string[] };
  }

  interface Navigator {
    standalone: any;
  }
}