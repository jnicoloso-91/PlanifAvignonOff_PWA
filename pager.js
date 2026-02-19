// pager.js 

import {
  afterFrames,
  openUrl, 
} from './utils.js';

import {
  isProgrammeCalendarVisible,
  rerenderProgrammeCalendar,
} from './calendar.js';

import { 
  ensureRowVisible,
  getSelectedRow,
  redrawAllGrids, 
} from './grids.js';

// Version circulaire avancée (pas de transitions vers vide) pour deux pages
// Avec page observer pour résolution du pb de mesure de pageW à l'init
(function initTwoPagePager(){
  const pager = document.getElementById('pager');
  const track = /** @type {HTMLElement} */ (pager?.querySelector('.pager-track'));
  const pages = track ? Array.from(track.querySelectorAll('.page')) : [];
  const btnNext = document.getElementById('pg-next');
  const btnAppLogo = document.getElementById('btn-app-logo');

  if (!pager || !track || pages.length === 0) {
    console.warn('[pager-test] structure introuvable');
    return;
  }

  let index = Number(pager.dataset.page || 0) || 0;
  let dragging = false, engaged = false, pending = false;
  let gestureActive = false;   // ce gesture est-il géré par le pager ?
  let gestureId = 0;           // juste pour debug/robustesse
  let startX = 0, startY = 0, curX = 0;
  let pageW = computePageW() ; 
  let roInstalled = false;
  let pagerRO = null;

  const N = pages.length;
  const WRAP_MS = 260;

  let pendingSnap = null; // { index:number, px:number } | null

  // Invariant DOM au repos: track contient [curEl, otherEl] et transform = 0
  let curEl   = pages[index];
  let otherEl = pages[1 - index];
  let basePx = 0;
  let dragDir = 0;           // -1 gauche, +1 droite
  let preparedRight = false;

  function setActiveByIndex(i){
    pages.forEach((p,k)=>p.classList.toggle('is-active', k===i));
    manageBottomBarVisibility(i);

    if (pages[i]?.classList.contains("page--planning")) {
      afterPlanningShown();
    }
  }

  function normalizeOrder(){
    track.replaceChildren(curEl, otherEl);
    preparedRight = false;
  }

  function prepareRight(){
    if (preparedRight) return;
    track.replaceChildren(otherEl, curEl);   // other à gauche, cur à droite
    preparedRight = true;
  }

  function commitSwap(){
    const tmp = curEl; curEl = otherEl; otherEl = tmp;
    index = 1 - index;
    normalizeOrder();
    applyTransform(0, false);
    setActiveByIndex(index);
  }

  function wrapIndex(i){
    return (i % N + N) % N;
  }

  function setActive(){
    pages.forEach((p,k)=>p.classList.toggle('is-active', k===index));
    manageBottomBarVisibility(index);
  }

  function measure(){
    pageW = computePageW() ; 
  }

  function computePageW() {
    const rect = pager.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return Math.round(rect.width * dpr) / dpr;
	}

  function installPagerObserver(){
    if (roInstalled) return;
    roInstalled = true;

    pagerRO = new ResizeObserver(() => {
      const w = computePageW();
      if (!w) return;
      if (Math.abs(w - pageW) < 0.5) return;
      pageW = w;
      snapToIndex(index);
    });

    pagerRO.observe(pager);

    // boot Firefox : 2 rAF
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const w = computePageW();
        if (w && Math.abs(w - pageW) >= 0.5) {
          pageW = w;
          snapToIndex(index);
        }
      });
    });
  }
  
  function applyTransform(px, animate=false){
    track.style.transition = animate ? 'transform .25s ease' : 'none';
    track.style.transform  = `translate3d(${px}px,0,0)`;
  }

  function setBottomBarVisible(visible){
		document.getElementById('bottomBar')?.classList.toggle('hidden', !visible);
		document.getElementById('toggleBar')?.classList.toggle('hidden', !visible);
		document.getElementById('safeMask')?.classList.toggle('hidden', !visible);
	}

	function manageBottomBarVisibility(i) {
		if (!pages[i]) return;
		const bottomBarVisible = pages[i]?.classList.contains('page--planning');
		setBottomBarVisible(bottomBarVisible);
	}

	function getPageIndexByClass(className) {
		if (!className) return -1;
		// Cherche la première page dont la classList contient className
		const idx = pages.findIndex(p => p.classList.contains(className));
		return idx;
	}

  function goto(i, animate=true){
    index = wrapIndex(i);
    applyTransform(-index * pageW, animate);
    setActive();
  }

  function snapToIndex(i){
    i = wrapIndex(i);

    // reset complet état geste/anim
    __pgAnimating = false;
    pendingSnap = null;

    dragging = false;
    engaged  = false;
    pending  = false;
    gestureActive = false;
    dragDir = 0;
    basePx = 0;
    preparedRight = false;

    pager.classList.remove("is-dragging");
    track.style.transition = "none";

    // 🔥 synchro ROYALE : cur/other + DOM invariant + transform repos
    index   = i;
    curEl   = pages[index];
    otherEl = pages[1 - index];

    normalizeOrder();         // DOM = [cur, other], preparedRight=false
    applyTransform(0, false); // repos visuel
    setActiveByIndex(index);  // active + bottom bar
  }

  function doPendingSnap(){
    if (!pendingSnap) return;
    const s = pendingSnap;
    pendingSnap = null;

    index = s.index;
    applyTransform(s.px, false);
    setActive();
  }

  async function waitLayoutStable(el, { minH = 50, timeout = 1500 } = {}) {
    const t0 = performance.now();

    // Optionnel mais très efficace sur Ctrl+F5 : attendre les fonts
    try { await document.fonts?.ready; } catch {}

    return await new Promise((resolve) => {
      let lastH = -1;
      let stableCount = 0;

      const step = () => {
        const h = el?.clientHeight || 0;

        // visible + mesurable
        if (h >= minH) {
          if (h === lastH) stableCount++;
          else stableCount = 0;

          lastH = h;

          // 2 frames consécutives stables
          if (stableCount >= 2) return resolve(true);
        }

        if (performance.now() - t0 > timeout) return resolve(false);

        requestAnimationFrame(step);
      };

      requestAnimationFrame(step);
    });
  }

  async function afterPlanningShown() {
    const planningPage = document.querySelector(".page--planning");
    if (!planningPage) return;
    await waitLayoutStable(planningPage, { minH: 80, timeout: 2000 });

    try { 
      if (isProgrammeCalendarVisible()) rerenderProgrammeCalendar?.(); 
      redrawAllGrids();
    } catch {}
  }

  let __pgAnimating = false;

  /**
   * 
   * @param {number} px 
   * @param {{ onDone?: Function }=} opts 
   */
  function animateTo(px, { onDone } = {}) {
    // robuste: transitionend + fallback
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      track.removeEventListener("transitionend", onEnd);
      __pgAnimating = false;
      onDone?.();
    };

    const onEnd = (e) => {
      if (e.propertyName !== "transform") return;
      finish();
    };

    __pgAnimating = true;
    track.addEventListener("transitionend", onEnd);

    applyTransform(px, true);

    // fallback (si transitionend ne fire pas)
    setTimeout(finish, 350);
  }

  function swipePage(dir){
    if (__pgAnimating) return;

    // reset: on coupe les transitions pour préparer proprement
    track.style.transition = "none";

    if (dir === +1) {
      // contenu part vers la droite => other à gauche, cur à droite
      prepareRight();                 // DOM = [other, cur]

      applyTransform(-pageW, false);  // état initial: cur visible

      // 🔥 important: forcer un "commit" de l'état initial avant d'animer
      // 1) reflow
      // eslint-disable-next-line no-unused-expressions
      track.offsetHeight;

      // 2) double RAF (WebKit/Firefox aiment ça)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          animateTo(0, { onDone: commitSwap }); // anime vers 0, puis swap
        });
      });

    } else {
      // contenu part vers la gauche => ordre normal
      normalizeOrder();              // DOM = [cur, other]
      applyTransform(0, false);

      // reflow + RAF pour symétrie
      // eslint-disable-next-line no-unused-expressions
      track.offsetHeight;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          animateTo(-pageW, { onDone: commitSwap });
        });
      });
    }
  }

  track.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'transform') doPendingSnap();
  });

  // Init
  measure();
  normalizeOrder();
  applyTransform(0, false);
  setActiveByIndex(index);

  // Observe les changements de largeur du pager induits par la scrollbar verticale qui apparait/disparait parfois au boot de l'appli
  installPagerObserver();

  // boutons
  btnNext?.addEventListener('click', () => {
    swipePage(-1);
  });

  btnAppLogo?.addEventListener('click', () => {
    swipePage(-1);
  });

	// Drag
  const DEADZONE = 10;   // px
  const THRESH   = 0.18; // 18% largeur

	// Sélecteurs “interactifs” où le pager NE doit PAS se déclencher
	const NO_SWIPE_START = [
		'.ag-root', '.ag-root-wrapper', '.ag-header', '.ag-header-cell', '.ag-cell',
		'.ag-header-cell-resize', '.ag-column-resize', // poignées de resize colonnes
		'.sheet-panel', '.sheet-header',               // sheets
		'input', 'select', 'textarea', 'button', 'a',  // éléments interactifs
		'.st-expander-header',                         // headers
		'#programme-panel #calA',                      // calendrier
    '.st-expander', '.st-expander-body',
    'input[type="range"]',
    '.slider', '.range', '.handle',
    // '.v-splitter',
		// '.page--planning',							             // page planning 
	].join(',');

	function isInNoSwipeZone(evTarget){
		return !!(evTarget && evTarget.closest && evTarget.closest(NO_SWIPE_START));
	}

  function onStart(ev){
    // reset dur à CHAQUE start (même si on ignore)
    gestureActive = false;
    gestureId++;

    dragging = false;
    engaged = false;
    pending = false;
    dragDir = 0;
    preparedRight = false;
    pager.classList.remove("is-dragging");
    track.style.transition = "none";

    // Si ça démarre dans une zone interdite -> le pager ne gère PAS ce gesture.
    if (isInNoSwipeZone(ev.target)) return;
    if (ev.defaultPrevented) return;

    const t = ev.touches ? ev.touches[0] : ev;
    startX = curX = t.clientX;
    startY = t.clientY;

    // ✅ seul cas où le pager peut traiter les move/end
    gestureActive = true;

    // si tu utilises pending/axis-lock :
    pending = true;
  }

  function onMove(ev){
  if (!gestureActive) return;   // ✅ CRITIQUE : aucune fuite possible
    // si on n'a rien en cours → rien à faire
    if (!pending && !dragging) return;

    const t  = ev.touches ? ev.touches[0] : ev;
    curX     = t.clientX;

    const dx = curX - startX;
    const dy = t.clientY - startY;

    const AXIS_MIN = Math.max(DEADZONE, 12); // px
    const RATIO = 1.25;

    // 1) Phase d'arbitrage (pending)
    if (pending){
      // attendre un vrai mouvement
      if (Math.abs(dx) < AXIS_MIN && Math.abs(dy) < AXIS_MIN) return;

      const ax = Math.abs(dx);
      const ay = Math.abs(dy);

      const horiz = ax > ay * RATIO;
      const vert  = ay > ax * RATIO;

      if (vert){
        // ✅ geste vertical : on abandonne le pager et on laisse scroller
        pending = false;
        dragging = false;
        engaged = false;
        return;
      }

      if (!horiz){
        // zone grise : on attend encore
        return;
      }

      // ✅ geste horizontal : on engage maintenant
      pending = false;
      dragging = true;
      engaged = true;
      pager.classList.add("is-dragging");
      track.style.transition = "none";

      // 🔒 desktop souris : capturer le pointer (STICKY MOUSE)
      if (ev.pointerId != null && pager.setPointerCapture) {
        try {
          pager.setPointerCapture(ev.pointerId);
        } catch {}
      }

      dragDir = (dx < 0) ? -1 : +1;

      if (dragDir === +1){
        prepareRight();
        basePx = -pageW;
        applyTransform(basePx, false);

        // important: "commit" visuel immédiat pour éviter glitch iOS
        // eslint-disable-next-line no-unused-expressions
        track.offsetHeight;
      } else {
        normalizeOrder?.(); // si tu as cette fonction (sinon enlève)
        basePx = 0;
        applyTransform(0, false);
        // eslint-disable-next-line no-unused-expressions
        track.offsetHeight;
      }
    }

    // 2) Phase drag réel
    if (!dragging) return;

    ev.preventDefault?.();
    applyTransform(basePx + dx, false);
  }

  //  (STICKY MOUSE)
  function onEnd(ev){
    if (!gestureActive) return; // ok

    // 🔓 libérer la capture si tu l’utilises (safe)
    if (ev?.pointerId != null && pager.releasePointerCapture){
      try { pager.releasePointerCapture(ev.pointerId); } catch {}
    }

    // ✅ CAS 1 : clic rapide / pas de drag (pending ou juste start)
    if (!dragging) {
      gestureActive = false;
      pending = false;
      engaged = false;
      dragDir = 0;
      pager.classList.remove("is-dragging");
      // optionnel : reset visuel si besoin
      // applyTransform(0, true);
      return;
    }

    // ✅ CAS 2 : vrai drag (ton code existant)
    dragging = false;
    pending = false;
    gestureActive = false;   // ✅ IMPORTANT : on ferme aussi ici
    pager.classList.remove('is-dragging');

    const dx = curX - startX;

    if (!engaged){
      applyTransform(0, true);
      return;
    }

    // COMMIT gauche (avancer)
    if (dragDir === -1 && dx < -THRESH * pageW){
      applyTransform(-pageW, true);
      setTimeout(() => { commitSwap(); }, 260);
      return;
    }

    // COMMIT droite (reculer)
    if (dragDir === +1 && dx > THRESH * pageW){
      applyTransform(0, true);
      setTimeout(() => { commitSwap(); }, 260);
      return;
    }

    // CANCEL
    if (dragDir === +1){
      applyTransform(-pageW, true);
      setTimeout(() => {
        normalizeOrder();
        applyTransform(0, false);
      }, 260);
    } else {
      applyTransform(0, true);
    }
  }

  // Écouteurs
  const IS_IOS =
    /iP(ad|hone|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  if (!IS_IOS && window.PointerEvent){
    pager.addEventListener('pointerdown', onStart, { passive: true });
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup',   onEnd,  { passive: true });
    window.addEventListener('pointercancel', onEnd, { passive: true });
  } else {
    pager.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove',  onMove, { passive: false });
    window.addEventListener('touchend',   onEnd,  { passive: true });
    window.addEventListener('pointercancel', onEnd, { passive: true });
  }

  window.addEventListener('resize', () => { measure(); snapToIndex(index); });
  window.addEventListener('mouseup', onEnd, { passive: true });


  // expose une interface permettant de changer de page depuis l’extérieur du pager (ex: welcome, calendrier, etc.)
  function setPage(i, animate = true){
    i = wrapIndex(i);
    if (i === index){
      snapToIndex(i);
      return;
    }

    if (!animate){
      snapToIndex(i);
      return;
    }

    // version animée : on utilise swipePage dans un sens constant
    const dir = (i === 1) ? -1 : +1;  // ici: 0=catalog, 1=planning
    swipePage(dir);
  }
  window.pager = { setPage };

	// Appelle le welcome et cache le pager en attendant
	(function bootWelcomeTransition(){
		const welcome = document.getElementById('welcome');
		const pager   = document.getElementById('pager');
		const body    = document.body;
		const header  = document.querySelector('header.app-header');
		if (!welcome || !pager) return;

		// État initial : header et bottom bar cachés, pager invisible
		body.classList.add('hide-app-header', 'transition-lock');
		body.classList.add('hide-bottom-bar', 'transition-lock');

		function revealPager() {
			body.classList.remove('hide-app-header');
			body.classList.remove('hide-bottom-bar');
			welcome.classList.add('is-leaving');
			requestAnimationFrame(() => pager.classList.add('is-entering'));

			const done = () => {
				welcome.removeEventListener('transitionend', done);
				welcome.remove();
				body.classList.remove('transition-lock');
				// petit fade-in du header
				header?.classList.remove('hidden');
			};
			welcome.addEventListener('transitionend', done, { once: true });
		}

		// Passage auto après xxx s
		const AUTO_DELAY_MS = 1000;
		setTimeout(revealPager, AUTO_DELAY_MS);

		// Ou tap manuel
		welcome.addEventListener('click', revealPager, { once: true });

	})();
	
	function wireCatalogButtons(){
		document.querySelectorAll('.catalog-btn[data-url]').forEach(btn => {
			// Est-ce bien un “button” cliquable
			(/** @type {HTMLButtonElement} */ (btn)).type = 'button';
			btn.addEventListener('click', (e) => {
				e.stopPropagation(); // évite d’interférer avec le swipe
				const raw = ((/** @type {HTMLButtonElement} */ (btn)).dataset.url || '').trim();
				if (!raw) return;
				openUrl(raw);
			});
		});
		document.querySelectorAll('.mini-corner-btn[data-url]').forEach(btn => {
			// Est-ce bien un “button” cliquable
			(/** @type {HTMLButtonElement} */ (btn)).type = 'button';
			btn.addEventListener('click', (e) => {
				e.stopPropagation(); // évite d’interférer avec le swipe
				const raw = ((/** @type {HTMLButtonElement} */ (btn)).dataset.url || '').trim();
				if (!raw) return;
				openUrl(raw);
			});
		});
		const btnMonProgramme = document.querySelector('#mon-programme.catalog-btn')
    btnMonProgramme.addEventListener('click', (e) => {
      e.stopPropagation();
      swipePage(-1);
    });
	}

	// 👉 Wirind des boutons du catalogue une fois le DOM prêt ET le pager affiché
	document.addEventListener('DOMContentLoaded', () => {
		wireCatalogButtons();
	});

})();
