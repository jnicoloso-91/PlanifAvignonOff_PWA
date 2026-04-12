// ===============================
// Utilitaires debug
// ===============================

const DEBUG = false;

let __dbgT = 0;

function getCaller(depth = 2) {
  try {
    throw new Error();
  } catch (e) {
    const stack = e.stack?.split("\n")[depth] || "";
    let match = stack.match(/at\s+(.*?)\s/);
    if (!match) { match = stack.match(/^([^\s@]+)/); }
    return match ? match[1] : "anonymous";
  }
}

// Console debug standard avec affichage du caller
export const log = (...a) => { if (DEBUG) console.debug(`[${getCaller(2)}]`, ...a); };

// Crée une mini-console dans la page pour afficher les logs sur iPhone
export function initPageLogger(){
// @ts-ignore
  if (window.__bbLog) return;

  const MAX = 300;         // lignes conservées
  const SHOW = 35;         // lignes visibles
  const buf = [];
  let seq = 0;

  function ensureBox(){
    let box = document.getElementById("bbLogBox");
    if (box) return box;

    box = document.createElement("pre");
    box.id = "bbLogBox";
    box.style.cssText = `
      position: fixed; z-index: 999999;
      left: 8px; right: 8px; bottom: 8px;
      max-height: 42vh; overflow: auto;
      background: rgba(0,0,0,.82);
      color: #d7ffd7; font: 12px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace;
      padding: 8px; border-radius: 8px;
      white-space: pre-wrap; word-break: break-word;
      pointer-events: none;
    `;
    document.body.appendChild(box);
    return box;
  }

  function oneLine(o){
    if (o == null) return "";
    if (typeof o === "string") return o;
    if (typeof o !== "object") return String(o);
    // compacte: key=val, tronque les valeurs longues
    const parts = [];
    for (const k of Object.keys(o)) {
      let v = o[k];
      if (typeof v === "number") v = Math.round(v * 1000) / 1000;
      else if (typeof v === "string" && v.length > 60) v = v.slice(0, 60) + "…";
      else if (typeof v === "object") v = "[obj]";
      parts.push(`${k}=${v}`);
    }
    return parts.join(" ");
  }

  function flush(){
    const box = ensureBox();
    const tail = buf.slice(-SHOW).join("\n");
    box.textContent = tail;
  }

// @ts-ignore
  window.__bbLog = function(tag, data){
    seq++;
    const line = `${seq.toString().padStart(4,"0")} ${tag} ${oneLine(data)}`;
    buf.push(line);
    if (buf.length > MAX) buf.splice(0, buf.length - MAX);
    flush();
  };

  // helper: effacer
// @ts-ignore
  window.__bbLogClear = function(){
    buf.length = 0;
    seq = 0;
    flush();
  };
}

// Affiche un log dans la mini-console 
export function logToPage(...args) {
  let el = document.getElementById('debug-console');
  if (!el) {
    el = document.createElement('pre');
    el.id = 'debug-console';
    el.style.position = 'fixed';
    el.style.bottom = '0';
    el.style.left = '0';
    el.style.width = '100%';
    el.style.maxHeight = '40vh';
    el.style.overflowY = 'auto';
    el.style.background = 'rgba(0,0,0,0.75)';
    el.style.color = '#0f0';
    el.style.fontSize = '11px';
    el.style.fontFamily = 'monospace';
    el.style.padding = '4px 6px';
    el.style.zIndex = '9999';
    el.style.whiteSpace = 'pre-wrap';
    el.style.pointerEvents = 'none';
    document.body.appendChild(el);
  }
  el.textContent += args.map(a => 
    typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
  ).join(' ') + '\n';
}

// Log throttlé pour éviter l'inondation
export function dbg(tag, obj) {
  const now = performance.now();
  if (now - __dbgT < 80) return;  // ~12 logs/sec
  __dbgT = now;
// @ts-ignore
  window.__bbLog?.(`${tag}: `, obj);
}

// Helpers à lancer en mode console (F12)
// BLOQUE TOUT preventDefault sur touch
// (function () {
//   const orig = Event.prototype.preventDefault;
//   Event.prototype.preventDefault = function () {
//     if (this.type.includes("touch") || this.type.includes("pointer")) {
//       console.log("BLOCK preventDefault", this.type);
//       return;
//     }
//     return orig.apply(this, arguments);
//   };
// })(); 

// Log le touch-action sur la chaine des parents
// function debugTouchChain(target) {
//   let n = target;
//   const chain = [];
//   while (n) {
//     if (n.nodeType === 1) {
//       const cs = getComputedStyle(n);
//       chain.push({
//         el: n.className || n.tagName,
//         touchAction: cs.touchAction,
//         overflowX: cs.overflowX,
//         overflowY: cs.overflowY,
//         pointerEvents: cs.pointerEvents
//       });
//     }
//     n = n.parentElement;
//   }
//   console.table(chain);
// }