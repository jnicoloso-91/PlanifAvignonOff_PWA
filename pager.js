// pager.js 

import {
  openUrl, 
} from './utils.js';

(function initTwoPagePager(){
  const pager = document.getElementById('pager');
  const track = pager?.querySelector('.pager-track');
  const pages = track ? Array.from(track.querySelectorAll('.page')) : [];
  // const btnPrev = document.getElementById('pg-prev');
  const btnNext = document.getElementById('pg-next');
  const btnAppLogo = document.getElementById('btn-app-logo');

  if (!pager || !track || pages.length === 0) {
    console.warn('[pager-test] structure introuvable');
    return;
  }

  let index = Number(pager.dataset.page || 0) || 0;
	// const hasDF = window.ctx?.df && window.ctx.df.length > 0;
	// let index = hasDF ? 0 : 1; // 1 = planning, 0 = catalogues

	let dragging = false, engaged = false;
  let startX = 0, startY = 0, curX = 0;
  let pageW = pager.clientWidth || window.innerWidth || 1;

  function measure(){
    pageW = pager.clientWidth || window.innerWidth || 1;
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
    index = Math.max(0, Math.min(pages.length-1, i));
    applyTransform(-index * pageW, animate);
    pages.forEach((p,k)=>p.classList.toggle('is-active', k===index));
		manageBottomBarVisibility(i);
    // console.log('[pager] goto', index, 'pageW=', pageW);
  }

  // Init
  measure();
  goto(index, false);

  // boutons
  // btnPrev?.addEventListener('click', () => index === 0 ? goto(index+1, true) : goto(index-1, true));
  btnNext?.addEventListener('click', () => index === 0 ? goto(index+1, true) : goto(index-1, true));
  btnAppLogo?.addEventListener('click', () => index === 0 ? goto(index+1, true) : goto(index-1, true));

	// Drag
  const DEADZONE = 10;   // px
  const THRESH   = 0.18; // 18% largeur

	// Sélecteurs “interactifs” où le pager NE doit PAS se déclencher
	const NO_SWIPE_START = [
		'.ag-root', '.ag-root-wrapper', '.ag-header', '.ag-header-cell', '.ag-cell',
		'.ag-header-cell-resize', '.ag-column-resize', // poignées de resize colonnes
		'.sheet-panel', '.sheet-header',               // si tu as des sheets
		'input', 'select', 'textarea', 'button', 'a',  // éléments interactifs
		'.st-expander-header'                          // si tu veux aussi ignorer ces headers
	].join(',');

	function isInNoSwipeZone(evTarget){
		return !!(evTarget && evTarget.closest && evTarget.closest(NO_SWIPE_START));
	}

  function onStart(ev){
    const t = ev.touches ? ev.touches[0] : ev;

		// Ne pas démarrer le pager-drag depuis une zone “interactive” (grilles, etc.)
		const target = ev.target;
		if (isInNoSwipeZone(target)) return;

		startX = curX = t.clientX;
    startY = t.clientY;
    dragging = true; engaged = false;
    track.style.transition = 'none';
  }
  function onMove(ev){
    if (!dragging) return;
    const t  = ev.touches ? ev.touches[0] : ev;
    curX     = t.clientX;
    const dx = curX - startX;
    const dy = t.clientY - startY;

    if (!engaged){
      if (Math.abs(dx) < DEADZONE && Math.abs(dy) < DEADZONE) return;
      if (Math.abs(dx) > Math.abs(dy)){
        engaged = true;
        pager.classList.add('is-dragging');
      } else {
        dragging = false; // geste vertical
        return;
      }
    }

    ev.preventDefault?.(); // bloque le scroll pendant le drag
    applyTransform((-index * pageW) + dx, false);
  }
  function onEnd(){
    if (!dragging) return;
    dragging = false;
    pager.classList.remove('is-dragging');

    const dx = curX - startX;
    if (engaged){
      if (dx >  THRESH * pageW) goto(index-1, true);
      else if (dx < -THRESH * pageW) goto(index+1, true);
      else goto(index, true);
    } else {
      goto(index, true);
    }
  }

  // Écouteurs
  if (window.PointerEvent){
    pager.addEventListener('pointerdown', onStart, { passive:true });
    window.addEventListener('pointermove', onMove, { passive:false });
    window.addEventListener('pointerup',   onEnd,  { passive:true });
    window.addEventListener('pointercancel', onEnd, { passive:true });
  } else {
    pager.addEventListener('touchstart', onStart, { passive:true });
    window.addEventListener('touchmove',  onMove, { passive:false });
    window.addEventListener('touchend',   onEnd,  { passive:true });
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
			btn.type = 'button';
			btn.addEventListener('click', (e) => {
				e.stopPropagation(); // évite d’interférer avec le swipe
				const raw = (btn.dataset.url || '').trim();
				if (!raw) return;
				openUrl(raw);
			});
		});
		const btnMonProgramme = document.querySelector('#mon-programme.catalog-btn')
		btnMonProgramme.addEventListener('click', (e) => {
			goto(getPageIndexByClass('page--planning'));
		});	
	}

	// 👉 Wirind des boutons du catalogue une fois le DOM prêt ET le pager affiché
	document.addEventListener('DOMContentLoaded', () => {
		wireCatalogButtons();
	});

})();

