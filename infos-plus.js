// =======================
// InfosPlus Popup
// =======================

import {
  escapeHtml,
} from './utils.js';

let _openPopover = null; // { el, anchorEl, onClose }

function closePopover() {
  if (!_openPopover) return;
  try { _openPopover.el.remove(); } catch {}
  _openPopover = null;
  document.removeEventListener("mousedown", _onDocPointerDown, true);
  document.removeEventListener("touchstart", _onDocPointerDown, true);
  document.removeEventListener("keydown", _onDocKeyDown, true);
}

function _onDocPointerDown(e) {
  if (!_openPopover) return;
  const { el, anchorEl } = _openPopover;
  // click à l'intérieur de la popover OU sur le bouton d’ancrage => ne ferme pas
  if (el.contains(e.target) || anchorEl.contains(e.target)) return;
  closePopover();
}

function _onDocKeyDown(e) {
  if (e.key === "Escape") closePopover();
}

// Cell Renderer des colonnes InfosPlus 
export function infosPlusPopoverCellRenderer(params) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "bb-info-btn";
  const row = params.data || {};
  if (row.__desc_summary || row.__avis_summary) {
    btn.textContent = "ℹ︎+";

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation(); // évite de sélectionner la ligne / déclencher d’autres handlers

      try {
        params.node?.setSelected?.(true, true);
      } catch {}

      openPopoverNear(btn, {
        title: row.Activite || row.activite || "Détails",
        // @ts-ignore
        style: row.Style,
        desc: row.__desc_summary,
        avis: row.__avis_summary,
        mood: row.Mood,
        note: row?.Note || null,
      });
    });
  }

  return btn;
}

/**
 *  Handler de click sur les boutons InfosPlus
 * @param {any} anchorEl
 * @param {{
 *   title?: string,
 *   style?: string,
 *   desc?: string,
 *   avis?: string,
 *   mood?: string,
 *   note?: (string|number|null)
 * }} opts
 */
export function openPopoverNear(anchorEl, { title = "Détails", style, desc, avis, mood, note=null } = {}) {
  closePopover();

  const pop = document.createElement("div");
  pop.className = "bb-popover";

  const safe = (v) => (v == null || String(v).trim() === "" ? "—" : String(v));

   pop.innerHTML = `
    <div class="bb-popover-body">
      <div>
        <span class="bb-k">${escapeHtml(safe(title))}</span>
        <span class="bb-v">(${escapeHtml(safe(style))})</span>
      </div>
      <div>
        <span class="bb-k">Description:</span>
        <span class="bb-v">${escapeHtml(safe(desc))}</span>
      </div>
      <div>
        <span class="bb-k">Avis:</span>
        <span class="bb-v">${escapeHtml(safe(avis))}</span>
      </div>
      <div>
        <span class="bb-k">Ton:</span>
        <span class="bb-v">${escapeHtml(safe(mood))}</span>
      </div>
      ${note == null ? `` : `
        <div>
          <span class="bb-k">Note:</span>
          <span class="bb-v">${escapeHtml(safe(note))}</span>
        </div>
      `}
    </div>
  `;

  document.body.appendChild(pop);

  // Positionnement (fixed) à droite du bouton si possible sinon à gauche, en restant dans l’écran
  const r = anchorEl.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();

  const margin = 8;
  let left = r.right + margin;               // à droite
  let top  = r.top - 6;                      // aligné haut

  // si ça déborde à droite, on passe à gauche
  if (left + pr.width > window.innerWidth - margin) {
    left = Math.max(margin, r.left - margin - pr.width);
  }
  // clamp vertical
  if (top + pr.height > window.innerHeight - margin) {
    top = Math.max(margin, window.innerHeight - margin - pr.height);
  }
  if (top < margin) top = margin;

  pop.style.left = `${left}px`;
  pop.style.top  = `${top}px`;

  _openPopover = { el: pop, anchorEl };

  // listeners en capture pour choper le click avant stopPropagation éventuel
  document.addEventListener("mousedown", _onDocPointerDown, true);
  document.addEventListener("touchstart", _onDocPointerDown, true);
  document.addEventListener("keydown", _onDocKeyDown, true);
}

// Wire les popups InfosPlus sur les boutons donnés
export function wireInfosPlusPopup(btn) {
  
  document.addEventListener("click", (e) => {
      // @ts-ignore
      const btn = e.target.closest(".prog-info-btn");
      if (!btn) return;

      e.preventDefault();
      e.stopPropagation();

      openPopoverNear(btn, {
        title: btn.dataset.title || "Détails",
        // @ts-ignore
        style: btn.dataset.style || "",
        desc:  btn.dataset.desc || "",
        avis:  btn.dataset.avis || "",
        mood:  btn.dataset.mood || "",
        note:  btn.dataset?.note || null,
      });
    });

  function closeAllInfoPopovers() {
    document.querySelectorAll(".bb-popover").forEach(p => p.remove());
  }

  document.addEventListener("scroll", closeAllInfoPopovers, { capture: true, passive: true });
  window.addEventListener("resize", () => closePopover());
}

