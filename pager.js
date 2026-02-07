// pager.js 

import {
  openUrl, 
} from './utils.js';

import {
  selectCurrentEventInCalendar, 
} from './calendar.js';

// Version originales avec bornes
// (function initTwoPagePager(){
//   const pager = document.getElementById('pager');
//   const track = /** @type {HTMLElement} */ (pager?.querySelector('.pager-track'));
//   const pages = track ? Array.from(track.querySelectorAll('.page')) : [];
//   const btnNext = document.getElementById('pg-next');
//   const btnAppLogo = document.getElementById('btn-app-logo');

//   if (!pager || !track || pages.length === 0) {
//     console.warn('[pager-test] structure introuvable');
//     return;
//   }

//   let index = Number(pager.dataset.page || 0) || 0;
//   let dragging = false, engaged = false;
//   let startX = 0, startY = 0, curX = 0;
//   let pageW = computePageW() ; 

//   function measure(){
//     pageW = computePageW() ; 
//   }

//   function computePageW() {
//     const rect = pager.getBoundingClientRect();
//     const dpr = window.devicePixelRatio || 1;
//     return Math.round(rect.width * dpr) / dpr;
// 	}

//   function applyTransform(px, animate=false){
//     track.style.transition = animate ? 'transform .25s ease' : 'none';
//     track.style.transform  = `translate3d(${px}px,0,0)`;
//   }

//   function setBottomBarVisible(visible){
// 		document.getElementById('bottomBar')?.classList.toggle('hidden', !visible);
// 		document.getElementById('toggleBar')?.classList.toggle('hidden', !visible);
// 		document.getElementById('safeMask')?.classList.toggle('hidden', !visible);
// 	}

// 	function manageBottomBarVisibility(i) {
// 		if (!pages[i]) return;
// 		const bottomBarVisible = pages[i]?.classList.contains('page--planning');
// 		setBottomBarVisible(bottomBarVisible);
// 	}

// 	function getPageIndexByClass(className) {
// 		if (!className) return -1;
// 		// Cherche la première page dont la classList contient className
// 		const idx = pages.findIndex(p => p.classList.contains(className));
// 		return idx;
// 	}

//   function goto(i, animate=true){
//     index = Math.max(0, Math.min(pages.length-1, i));
//     applyTransform(-index * pageW, animate);
//     pages.forEach((p,k)=>p.classList.toggle('is-active', k===index));
// 		manageBottomBarVisibility(i);
//     // console.log('[pager] goto', index, 'pageW=', pageW);
//   }

//   // Init
//   measure();
//   goto(index, false);

//   // boutons
//   // btnPrev?.addEventListener('click', () => index === 0 ? goto(index+1, true) : goto(index-1, true));
//   btnNext?.addEventListener('click', () => index === 0 ? goto(index+1, true) : goto(index-1, true));
//   btnAppLogo?.addEventListener('click', () => index === 0 ? goto(index+1, true) : goto(index-1, true));

// 	// Drag
//   const DEADZONE = 10;   // px
//   const THRESH   = 0.18; // 18% largeur

// 	// Sélecteurs “interactifs” où le pager NE doit PAS se déclencher
// 	const NO_SWIPE_START = [
// 		'.ag-root', '.ag-root-wrapper', '.ag-header', '.ag-header-cell', '.ag-cell',
// 		'.ag-header-cell-resize', '.ag-column-resize', // poignées de resize colonnes
// 		'.sheet-panel', '.sheet-header',               // si tu as des sheets
// 		'input', 'select', 'textarea', 'button', 'a',  // éléments interactifs
// 		'.st-expander-header',                         // headers
// 		'#programme-panel #calA',                      // calendrier
// 		// '.page--planning',							   // page planning 
// 	].join(',');

// 	function isInNoSwipeZone(evTarget){
// 		return !!(evTarget && evTarget.closest && evTarget.closest(NO_SWIPE_START));
// 	}

//   function onStart(ev){

// 		// Ne pas démarrer le pager-drag depuis une zone “interactive” (grilles, etc.)
// 		const target = ev.target;
// 		if (isInNoSwipeZone(ev.target)) return;

//     const t = ev.touches ? ev.touches[0] : ev;
// 		startX = curX = t.clientX;
//     startY = t.clientY;
//     dragging = true; engaged = false;
//     track.style.transition = 'none';
//   }
//   function onMove(ev){
//     if (!dragging) return;
//     const t  = ev.touches ? ev.touches[0] : ev;
//     curX     = t.clientX;
//     const dx = curX - startX;
//     const dy = t.clientY - startY;

//     if (!engaged){
//       if (Math.abs(dx) < DEADZONE && Math.abs(dy) < DEADZONE) return;
//       if (Math.abs(dx) > Math.abs(dy)){
//         engaged = true;
//         pager.classList.add('is-dragging');
//       } else {
//         dragging = false; // geste vertical
//         return;
//       }
//     }

//     ev.preventDefault?.(); // bloque le scroll pendant le drag
//     applyTransform((-index * pageW) + dx, false);
//   }
//   function onEnd(){
//     if (!dragging) return;
//     dragging = false;
//     pager.classList.remove('is-dragging');

//     const dx = curX - startX;
//     if (engaged){
//       if (dx >  THRESH * pageW) goto(index-1, true);
//       else if (dx < -THRESH * pageW) goto(index+1, true);
//       else goto(index, true);
//     } else {
//       goto(index, true);
//     }
//   }

//   // Écouteurs
//   if (window.PointerEvent){
//     pager.addEventListener('pointerdown', onStart, { passive:true });
//     window.addEventListener('pointermove', onMove, { passive:false });
//     window.addEventListener('pointerup',   onEnd,  { passive:true });
//     window.addEventListener('pointercancel', onEnd, { passive:true });
//   } else {
//     pager.addEventListener('touchstart', onStart, { passive:true });
//     window.addEventListener('touchmove',  onMove, { passive:false });
//     window.addEventListener('touchend',   onEnd,  { passive:true });
//   }

//   window.addEventListener('resize', () => { measure(); goto(index, false); });

//   // expose
//   window.pager = { goto };

// 	// Appelle le welcome et cache le pager en attendant
// 	(function bootWelcomeTransition(){
// 		const welcome = document.getElementById('welcome');
// 		const pager   = document.getElementById('pager');
// 		const body    = document.body;
// 		const header  = document.querySelector('header.app-header');
// 		if (!welcome || !pager) return;

// 		// État initial : header et bottom bar cachés, pager invisible
// 		body.classList.add('hide-app-header', 'transition-lock');
// 		body.classList.add('hide-bottom-bar', 'transition-lock');

// 		function revealPager() {
// 			body.classList.remove('hide-app-header');
// 			body.classList.remove('hide-bottom-bar');
// 			welcome.classList.add('is-leaving');
// 			requestAnimationFrame(() => pager.classList.add('is-entering'));

// 			const done = () => {
// 				welcome.removeEventListener('transitionend', done);
// 				welcome.remove();
// 				body.classList.remove('transition-lock');
// 				// petit fade-in du header
// 				header?.classList.remove('hidden');
// 			};
// 			welcome.addEventListener('transitionend', done, { once: true });
// 		}

// 		// Passage auto après xxx s
// 		const AUTO_DELAY_MS = 1000;
// 		setTimeout(revealPager, AUTO_DELAY_MS);

// 		// Ou tap manuel
// 		welcome.addEventListener('click', revealPager, { once: true });

// 	})();
	
// 	function wireCatalogButtons(){
// 		document.querySelectorAll('.catalog-btn[data-url]').forEach(btn => {
// 			// Est-ce bien un “button” cliquable
// 			(/** @type {HTMLButtonElement} */ (btn)).type = 'button';
// 			btn.addEventListener('click', (e) => {
// 				e.stopPropagation(); // évite d’interférer avec le swipe
// 				const raw = ((/** @type {HTMLButtonElement} */ (btn)).dataset.url || '').trim();
// 				if (!raw) return;
// 				openUrl(raw);
// 			});
// 		});
// 		document.querySelectorAll('.mini-corner-btn[data-url]').forEach(btn => {
// 			// Est-ce bien un “button” cliquable
// 			(/** @type {HTMLButtonElement} */ (btn)).type = 'button';
// 			btn.addEventListener('click', (e) => {
// 				e.stopPropagation(); // évite d’interférer avec le swipe
// 				const raw = ((/** @type {HTMLButtonElement} */ (btn)).dataset.url || '').trim();
// 				if (!raw) return;
// 				openUrl(raw);
// 			});
// 		});
// 		const btnMonProgramme = document.querySelector('#mon-programme.catalog-btn')
// 		btnMonProgramme.addEventListener('click', (e) => {
// 			selectCurrentEventInCalendar();
// 			goto(getPageIndexByClass('page--planning'));
// 		});	
// 	}

// 	// 👉 Wirind des boutons du catalogue une fois le DOM prêt ET le pager affiché
// 	document.addEventListener('DOMContentLoaded', () => {
// 		wireCatalogButtons();
// 	});

// })();

// Version circulaire basique
// (function initTwoPagePager(){
//   const pager = document.getElementById('pager');
//   const track = /** @type {HTMLElement} */ (pager?.querySelector('.pager-track'));
//   const pages = track ? Array.from(track.querySelectorAll('.page')) : [];
//   const btnNext = document.getElementById('pg-next');
//   const btnAppLogo = document.getElementById('btn-app-logo');

//   if (!pager || !track || pages.length === 0) {
//     console.warn('[pager-test] structure introuvable');
//     return;
//   }

//   let index = Number(pager.dataset.page || 0) || 0;
//   let dragging = false, engaged = false;
//   let startX = 0, startY = 0, curX = 0;
//   let pageW = computePageW() ; 
//   let roInstalled = false;
//   let pagerRO = null;

//   const N = pages.length;
//   const WRAP_MS = 260;

//   let pendingSnap = null; // { index:number, px:number } | null

//   function wrapIndex(i){
//     return (i % N + N) % N;
//   }

//   function setActive(){
//     pages.forEach((p,k)=>p.classList.toggle('is-active', k===index));
//     manageBottomBarVisibility(index);
//   }

//   function measure(){
//     pageW = computePageW() ; 
//   }

//   function computePageW() {
//     const rect = pager.getBoundingClientRect();
//     const dpr = window.devicePixelRatio || 1;
//     return Math.round(rect.width * dpr) / dpr;
// 	}

//   function installPagerObserver(){
//     if (roInstalled) return;
//     roInstalled = true;

//     pagerRO = new ResizeObserver(() => {
//       const w = computePageW();
//       if (!w) return;
//       if (Math.abs(w - pageW) < 0.5) return;
//       pageW = w;
//       goto(index, false);
//     });

//     pagerRO.observe(pager);

//     // boot Firefox : 2 rAF
//     requestAnimationFrame(() => {
//       requestAnimationFrame(() => {
//         const w = computePageW();
//         if (w && Math.abs(w - pageW) >= 0.5) {
//           pageW = w;
//           goto(index, false);
//         }
//       });
//     });
//   }
  
//   function applyTransform(px, animate=false){
//     track.style.transition = animate ? 'transform .25s ease' : 'none';
//     track.style.transform  = `translate3d(${px}px,0,0)`;
//   }

//   function setBottomBarVisible(visible){
// 		document.getElementById('bottomBar')?.classList.toggle('hidden', !visible);
// 		document.getElementById('toggleBar')?.classList.toggle('hidden', !visible);
// 		document.getElementById('safeMask')?.classList.toggle('hidden', !visible);
// 	}

// 	function manageBottomBarVisibility(i) {
// 		if (!pages[i]) return;
// 		const bottomBarVisible = pages[i]?.classList.contains('page--planning');
// 		setBottomBarVisible(bottomBarVisible);
// 	}

// 	function getPageIndexByClass(className) {
// 		if (!className) return -1;
// 		// Cherche la première page dont la classList contient className
// 		const idx = pages.findIndex(p => p.classList.contains(className));
// 		return idx;
// 	}

//   function goto(i, animate=true){
//     index = wrapIndex(i);
//     applyTransform(-index * pageW, animate);
//     setActive();
//   }

//   function doPendingSnap(){
//     if (!pendingSnap) return;
//     const s = pendingSnap;
//     pendingSnap = null;

//     index = s.index;
//     applyTransform(s.px, false);
//     setActive();
//   }

//   track.addEventListener('transitionend', (e) => {
//     if (e.propertyName === 'transform') doPendingSnap();
//   });

//   function scheduleSnapFallback(){
//     if (!pendingSnap) return;
//     setTimeout(doPendingSnap, WRAP_MS);
//   }

//   /**
//    * dir = -1 → swipe gauche (avancer)
//    * dir = +1 → swipe droite (reculer)
//    */
//   function goSwipe(dir){
//     if (N <= 1) return;

//     const atFirst = index === 0;
//     const atLast  = index === N - 1;

//     // ── WRAP gauche : dernière → première
//     if (dir === -1 && atLast){
//       pendingSnap = { index: 0, px: 0 };
//       applyTransform(-(N) * pageW, true); // vers le "vide" à gauche
//       scheduleSnapFallback();
//       return;
//     }

//     // ── WRAP droite : première → dernière
//     if (dir === +1 && atFirst){
//       pendingSnap = { index: N - 1, px: -(N - 1) * pageW };
//       applyTransform(+pageW, true); // vers le "vide" à droite
//       scheduleSnapFallback();
//       return;
//     }

//     // ── CAS NORMAL
//     pendingSnap = null;
//     goto(index + (dir === -1 ? 1 : -1), true);
//   }

//   function goToPageByClass(className, dir = -1) {
//     const target = getPageIndexByClass(className);
//     if (target < 0 || target === index) return;

//     // nombre de pas à faire dans la direction choisie
//     const N = pages.length;
//     let steps = 0;

//     if (dir === -1) {
//       // avancer (gauche)
//       steps = (target - index + N) % N;
//     } else {
//       // reculer (droite)
//       steps = (index - target + N) % N;
//     }

//     if (steps === 0) return;

//     // on avance d’un pas par animation (plus lisible)
//     const stepOnce = () => {
//       if (steps-- <= 0) return;
//       goSwipe(dir);
//       if (steps > 0) {
//         setTimeout(stepOnce, WRAP_MS);
//       }
//     };

//     stepOnce();
//   }
//   // Init
//   measure();
//   goto(index, false);

//   // Observe les changements de largeur du pager induits par la scrollbar verticale qui apparait/disparait parfois au boot de l'appli
//   installPagerObserver();

//   // boutons
//   btnNext?.addEventListener('click', () => goSwipe(-1));
//   btnAppLogo?.addEventListener('click', () => goSwipe(-1));

// 	// Drag
//   const DEADZONE = 10;   // px
//   const THRESH   = 0.18; // 18% largeur

// 	// Sélecteurs “interactifs” où le pager NE doit PAS se déclencher
// 	const NO_SWIPE_START = [
// 		'.ag-root', '.ag-root-wrapper', '.ag-header', '.ag-header-cell', '.ag-cell',
// 		'.ag-header-cell-resize', '.ag-column-resize', // poignées de resize colonnes
// 		'.sheet-panel', '.sheet-header',               // si tu as des sheets
// 		'input', 'select', 'textarea', 'button', 'a',  // éléments interactifs
// 		'.st-expander-header',                         // headers
// 		'#programme-panel #calA',                      // calendrier
//    '.v-splitter',
// 		// '.page--planning',							   // page planning 
// 	].join(',');

// 	function isInNoSwipeZone(evTarget){
// 		return !!(evTarget && evTarget.closest && evTarget.closest(NO_SWIPE_START));
// 	}

//   function onStart(ev){

// 		// Ne pas démarrer le pager-drag depuis une zone “interactive” (grilles, etc.)
// 		const target = ev.target;
// 		if (isInNoSwipeZone(ev.target)) return;

//     const t = ev.touches ? ev.touches[0] : ev;
// 		startX = curX = t.clientX;
//     startY = t.clientY;
//     dragging = true; engaged = false;
//     track.style.transition = 'none';
//   }
//   function onMove(ev){
//     if (!dragging) return;
//     const t  = ev.touches ? ev.touches[0] : ev;
//     curX     = t.clientX;
//     const dx = curX - startX;
//     const dy = t.clientY - startY;

//     if (!engaged){
//       if (Math.abs(dx) < DEADZONE && Math.abs(dy) < DEADZONE) return;
//       if (Math.abs(dx) > Math.abs(dy)){
//         engaged = true;
//         pager.classList.add('is-dragging');
//       } else {
//         dragging = false; // geste vertical
//         return;
//       }
//     }

//     ev.preventDefault?.(); // bloque le scroll pendant le drag
//     applyTransform((-index * pageW) + dx, false);
//   }
//   function onEnd(){
//     if (!dragging) return;
//     dragging = false;
//     pager.classList.remove('is-dragging');

//     const dx = curX - startX;
//     if (engaged){
//        if (dx >  THRESH * pageW) goSwipe(+1);      // swipe droite
//        else if (dx < -THRESH * pageW) goSwipe(-1); // swipe gauche
//        else goto(index, true);
//     } else {
//       goto(index, true);
//     }
//   }

//   // Écouteurs
//   if (window.PointerEvent){
//     pager.addEventListener('pointerdown', onStart, { passive:true });
//     window.addEventListener('pointermove', onMove, { passive:false });
//     window.addEventListener('pointerup',   onEnd,  { passive:true });
//     window.addEventListener('pointercancel', onEnd, { passive:true });
//   } else {
//     pager.addEventListener('touchstart', onStart, { passive:true });
//     window.addEventListener('touchmove',  onMove, { passive:false });
//     window.addEventListener('touchend',   onEnd,  { passive:true });
//   }

//   window.addEventListener('resize', () => { measure(); goto(index, false); });

//   // expose
//   window.pager = { goto };

// 	// Appelle le welcome et cache le pager en attendant
// 	(function bootWelcomeTransition(){
// 		const welcome = document.getElementById('welcome');
// 		const pager   = document.getElementById('pager');
// 		const body    = document.body;
// 		const header  = document.querySelector('header.app-header');
// 		if (!welcome || !pager) return;

// 		// État initial : header et bottom bar cachés, pager invisible
// 		body.classList.add('hide-app-header', 'transition-lock');
// 		body.classList.add('hide-bottom-bar', 'transition-lock');

// 		function revealPager() {
// 			body.classList.remove('hide-app-header');
// 			body.classList.remove('hide-bottom-bar');
// 			welcome.classList.add('is-leaving');
// 			requestAnimationFrame(() => pager.classList.add('is-entering'));

// 			const done = () => {
// 				welcome.removeEventListener('transitionend', done);
// 				welcome.remove();
// 				body.classList.remove('transition-lock');
// 				// petit fade-in du header
// 				header?.classList.remove('hidden');
// 			};
// 			welcome.addEventListener('transitionend', done, { once: true });
// 		}

// 		// Passage auto après xxx s
// 		const AUTO_DELAY_MS = 1000;
// 		setTimeout(revealPager, AUTO_DELAY_MS);

// 		// Ou tap manuel
// 		welcome.addEventListener('click', revealPager, { once: true });

// 	})();
	
// 	function wireCatalogButtons(){
// 		document.querySelectorAll('.catalog-btn[data-url]').forEach(btn => {
// 			// Est-ce bien un “button” cliquable
// 			(/** @type {HTMLButtonElement} */ (btn)).type = 'button';
// 			btn.addEventListener('click', (e) => {
// 				e.stopPropagation(); // évite d’interférer avec le swipe
// 				const raw = ((/** @type {HTMLButtonElement} */ (btn)).dataset.url || '').trim();
// 				if (!raw) return;
// 				openUrl(raw);
// 			});
// 		});
// 		document.querySelectorAll('.mini-corner-btn[data-url]').forEach(btn => {
// 			// Est-ce bien un “button” cliquable
// 			(/** @type {HTMLButtonElement} */ (btn)).type = 'button';
// 			btn.addEventListener('click', (e) => {
// 				e.stopPropagation(); // évite d’interférer avec le swipe
// 				const raw = ((/** @type {HTMLButtonElement} */ (btn)).dataset.url || '').trim();
// 				if (!raw) return;
// 				openUrl(raw);
// 			});
// 		});
// 		const btnMonProgramme = document.querySelector('#mon-programme.catalog-btn')
//     btnMonProgramme.addEventListener('click', (e) => {
//       e.stopPropagation();
//       selectCurrentEventInCalendar();
//       goToPageByClass('page--planning', -1); // toujours “avancer”
//     });
// 	}

// 	// 👉 Wirind des boutons du catalogue une fois le DOM prêt ET le pager affiché
// 	document.addEventListener('DOMContentLoaded', () => {
// 		wireCatalogButtons();
// 	});

// })();

// Version Royal pour deux pages
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
      goto(index, false);
    });

    pagerRO.observe(pager);

    // boot Firefox : 2 rAF
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const w = computePageW();
        if (w && Math.abs(w - pageW) >= 0.5) {
          pageW = w;
          goto(index, false);
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

  function doPendingSnap(){
    if (!pendingSnap) return;
    const s = pendingSnap;
    pendingSnap = null;

    index = s.index;
    applyTransform(s.px, false);
    setActive();
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

  // function onStart(ev){
  //   if (isInNoSwipeZone(ev.target)) return;
  //   if (ev.defaultPrevented) return;

  //   const t = ev.touches ? ev.touches[0] : ev;
  //   startX = curX = t.clientX;
  //   startY = t.clientY;

  //   dragging = false;
  //   engaged = false;
  //   pending = true;
  //   dragDir = 0;
  //   preparedRight = false;

  //   track.style.transition = 'none';

  //   // repos: [cur, other] visible, transform=0
  //   normalizeOrder();
  //   basePx = 0;
  //   applyTransform(0, false);
  // }

  // function onMove(ev){
  //   if (!dragging) return;

  //   const t  = ev.touches ? ev.touches[0] : ev;
  //   curX     = t.clientX;

  //   const dx = curX - startX;
  //   const dy = t.clientY - startY;

  //   if (!engaged){
  //     if (Math.abs(dx) < DEADZONE && Math.abs(dy) < DEADZONE) return;

  //     if (Math.abs(dx) > Math.abs(dy)){
  //       engaged = true;
  //       pager.classList.add('is-dragging');

  //       dragDir = (dx < 0) ? -1 : +1;

  //       if (dragDir === +1){
  //         // drag vers la droite: rendre "other" disponible à gauche
  //         prepareRight();
  //         basePx = -pageW;         // cur reste visible (dans le slot de droite)
  //         applyTransform(basePx, false);
  //       } else {
  //         // drag vers la gauche: ordre normal
  //         basePx = 0;
  //       }
  //     } else {
  //       dragging = false;
  //       return;
  //     }
  //   }

  //   ev.preventDefault?.();
  //   applyTransform(basePx + dx, false);
  // }
  // function onMove(ev){
  //   if (!dragging) return;

  //   const t  = ev.touches ? ev.touches[0] : ev;
  //   curX     = t.clientX;

  //   const dx = curX - startX;
  //   const dy = t.clientY - startY;

  //   // iOS: durcir l'arbitrage pour ne pas tuer le scroll vertical
  //   const AXIS_MIN = Math.max(DEADZONE, 12); // px
  //   const RATIO = 1.25;                      // 1.15..1.4 selon feeling

  //   if (!engaged){
  //     // attendre un vrai mouvement (évite la prise en charge trop tôt)
  //     if (Math.abs(dx) < AXIS_MIN && Math.abs(dy) < AXIS_MIN) return;

  //     const ax = Math.abs(dx);
  //     const ay = Math.abs(dy);

  //     const horiz = ax > ay * RATIO;
  //     const vert  = ay > ax * RATIO;

  //     if (horiz){
  //       engaged = true;
  //       pager.classList.add('is-dragging');

  //       dragDir = (dx < 0) ? -1 : +1;

  //       if (dragDir === +1){
  //         // drag vers la droite: rendre "other" disponible à gauche
  //         prepareRight();
  //         basePx = -pageW;         // cur reste visible (slot de droite)
  //         applyTransform(basePx, false);
  //       } else {
  //         // drag vers la gauche: ordre normal
  //         basePx = 0;
  //       }
  //     } else if (vert){
  //       // geste vertical => laisser la page scroller, le pager lâche prise
  //       dragging = false;
  //       return;
  //     } else {
  //       // zone grise (diagonale) => on attend encore
  //       return;
  //     }
  //   }

  //   // IMPORTANT: ne bloquer le scroll que quand on a vraiment pris le geste
  //   if (engaged) ev.preventDefault?.();

  //   applyTransform(basePx + dx, false);
  // }
//   function onStart(ev){
//   // ✅ Reset systématique (même si on ignore ce start)
//   dragging = false;
//   engaged = false;
//   pending = false;      // on le remet à true seulement si on accepte le start
//   dragDir = 0;
//   preparedRight = false;
//   pager.classList.remove("is-dragging");
//   track.style.transition = "none";

//   // repos: [cur, other] visible, transform=0
//   normalizeOrder();
//   basePx = 0;
//   applyTransform(0, false);

//   // Ensuite seulement, décider si on ignore ce start
//   if (isInNoSwipeZone(ev.target)) return;
//   if (ev.defaultPrevented) return;

//   const t = ev.touches ? ev.touches[0] : ev;
//   startX = curX = t.clientX;
//   startY = t.clientY;

//   pending = true;
// }  
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

  function onEnd(){
if (!gestureActive) return;   // ✅ CRITIQUE : aucune fuite possible
    if (!dragging) return;

    dragging = false;
    pending = false;
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
  // if (window.PointerEvent){
    pager.addEventListener('pointerdown', onStart, { passive:true });
    window.addEventListener('pointermove', onMove, { passive:false });
    window.addEventListener('pointerup',   onEnd,  { passive:true });
    window.addEventListener('pointercancel', onEnd, { passive:true });
  } else {
    pager.addEventListener('touchstart', onStart, { passive:true });
    window.addEventListener('touchmove',  onMove, { passive:false });
    window.addEventListener('touchend',   onEnd,  { passive:true });
    window.addEventListener('pointercancel', onEnd, { passive:true });
  }

  window.addEventListener('resize', () => { measure(); goto(index, false); });

  // expose
  window.pager = { goto };

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

      // sélectionne l'event dans le calendrier
      selectCurrentEventInCalendar();

      // // si on est déjà sur le planning → rien à faire
      // if (curEl.classList.contains('page--planning')) return;

      // // sinon : avancer d’un cran (même anim que swipe gauche)
      // applyTransform(-pageW, true);
      // setTimeout(() => {
      //   commitSwap(); // inverse curEl / otherEl + reset
      // }, 260);
      swipePage(-1);
    });
	}

	// 👉 Wirind des boutons du catalogue une fois le DOM prêt ET le pager affiché
	document.addEventListener('DOMContentLoaded', () => {
		wireCatalogButtons();
	});

})();
