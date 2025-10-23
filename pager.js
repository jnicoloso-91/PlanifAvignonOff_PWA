// pager.js — une seule implémentation
// (() => {
//   const pager  = document.getElementById('pager');
//   const track  = pager?.querySelector('.pager-track');
//   const pages  = track ? Array.from(track.children) : [];
//   const header = document.getElementById('appHeader');
//   const btnPrev = document.getElementById('pager-prev');
//   const btnNext = document.getElementById('pager-next');

//   if (!pager || !track || pages.length === 0) return;

//   // largeur piste + largeur pages = 100% par page
//   track.style.width = `${pages.length * 100}%`;
//   pages.forEach(p => { p.style.flex = '0 0 100%'; p.style.minWidth = '100%'; });

//   // bornes : on ignore la page 0 dans la nav
//   const MIN = 1, MAX = 2;
//   let index = 1; // démarrage sur 1 (ou passe auto à 2 plus tard)

//   // helpers wrap
//   const wrapPrev = (i) => (i <= MIN ? MAX : i - 1);
//   const wrapNext = (i) => (i >= MAX ? MIN : i + 1);

//   const clamp = i => Math.max(0, Math.min(pages.length - 1, i));

//   function setHeaderVisible(visible){
//     header?.classList.toggle('hidden', !visible);
//     document.body.classList.toggle('no-header', !visible);
//   }

// 	// goTo : ne clamp plus vers 0, borne à [1..2]
// 	function goTo(i, animate = true){
// 		index = Math.max(MIN, Math.min(MAX, i));
// 		track.style.transition = animate ? 'transform .25s ease' : 'none';
// 		track.style.transform  = `translateX(${-(index) * 100}%)`;

// 		// largeur auto pour la page active
// 		pages.forEach((p, k) => p.style.flex = (k === index ? 'auto' : '0 0 100%'));

// 		// header visible sur 1/2, caché sur 0 (optionnel, mais tu voulais 0 hors-circuit)
// 		setHeaderVisible(index !== 0);
// 	}

//   // boutons
//   btnPrev?.addEventListener('click', () => goTo(wrapPrev(index)));
//   btnNext?.addEventListener('click', () => goTo(wrapNext(index)));

//   // swipe horizontal
//   let startX = 0, curX = 0, dragging = false;
//   const onStart = e => {
//     dragging = true;
//     const t = e.touches ? e.touches[0] : e;
//     startX = curX = t.clientX;
//     track.style.transition = 'none';
//   };
//   const onMove = e => {
//     if (!dragging) return;
//     const t = e.touches ? e.touches[0] : e;
//     curX = t.clientX;
//     const dx = curX - startX;
//     const w = pager.getBoundingClientRect().width || 1;
//     const pct = (dx / w) * 100;
//     track.style.transform = `translateX(calc(${-index*100}% + ${pct}%))`;
//     e.preventDefault?.();
//   };
// 	function onEnd(){
// 	if (!dragging) return;
// 	dragging = false;
// 	const dx = curX - startX;
// 	const w  = pager.getBoundingClientRect().width || 1;
// 	const THRESH = 0.12 * w;

// 	if (dx > THRESH) goTo(wrapPrev(index));
// 	else if (dx < -THRESH) goTo(wrapNext(index));
// 	else goTo(index); // revient en place
// 	};

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

//   // démarrer sur Welcome puis auto → Planning
//   goTo(0, { animate: false });
//   setTimeout(() => goTo(2), 2500);

//   // expose si besoin
//   window.pager = { goTo };
// })();


(function initTwoPagePager(){
  const pager = document.getElementById('pager');
  const track = pager?.querySelector('.pager-track');
  const pages = track ? Array.from(track.querySelectorAll('.page')) : [];
  // const btnPrev = document.getElementById('pg-prev');
  const btnNext = document.getElementById('pg-next');

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

// Drag
  const DEADZONE = 10;   // px
  const THRESH   = 0.18; // 18% largeur

  function onStart(ev){
    const t = ev.touches ? ev.touches[0] : ev;
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
	// (function bootWelcome({
	// 	duration = 2000,   // auto-close after X ms
	// 	tapToSkip = true,  // tap to skip immediately
	// } = {}) {
	// 	const welcome = document.getElementById('welcome');
	// 	const header  = document.getElementById('appHeader');
	// 	const pager   = document.getElementById('pager');
	// 	const bottom  = document.getElementById('bottomBar');

	// 	if (!welcome) return;

	// 	// Show welcome, hide app chrome (do NOT pre-set hidden in HTML)
	// 	welcome.classList.add('is-visible');
	// 	header?.setAttribute('aria-hidden', 'true');
	// 	pager?.setAttribute('aria-hidden', 'true');
	// 	bottom?.setAttribute('aria-hidden', 'true');

	// 	// Block interaction + hide visually
	// 	header && (header.inert = true, header.hidden = true);
	// 	pager  && (pager.inert  = true, pager.hidden  = true);
	// 	bottom && (bottom.inert = true, bottom.hidden = true);

	// 	let closed = false;
	// 	const close = () => {
	// 		if (closed) return;
	// 		closed = true;

	// 		welcome.classList.remove('is-visible');

	// 		// Unhide / re-enable app chrome
	// 		[header, pager, bottom].forEach(el => {
	// 			if (!el) return;
	// 			el.hidden = false;
	// 			el.inert = false;
	// 			el.removeAttribute('aria-hidden');
	// 		});

	// 		// Let CSS fade the welcome; then remove it
	// 		setTimeout(() => welcome.remove(), 300);

	// 		// Land on the first real page (planning or whatever you want)
	// 		try { window.pager?.goTo?.(0); } catch {}
	// 	};

	// 	if (tapToSkip) {
	// 		welcome.addEventListener('click', close, { passive: true });
	// 		welcome.addEventListener('touchstart', close, { passive: true });
	// 	}

	// 	setTimeout(close, duration);
	// })();
	// (function bootWelcomeTransition(){
	// 	const welcome = document.getElementById('welcome');
	// 	const pager   = document.getElementById('pager');
	// 	if (!welcome || !pager) return;

	// 	// État initial: pager caché visuellement (via CSS) mais déjà en layout.
	// 	document.body.classList.add('transition-lock');

	// 	// Quand on doit passer au pager
	// 	function revealPager() {
	// 		// lance l’anim de sortie du welcome
	// 		welcome.classList.add('is-leaving');

	// 		// au prochain frame, lance l’entrée du pager
	// 		requestAnimationFrame(() => {
	// 			pager.classList.add('is-entering');
	// 		});

	// 		// à la fin des transitions, nettoie et retire le welcome
	// 		const done = () => {
	// 			welcome.removeEventListener('transitionend', done);
	// 			// supprime le welcome du DOM (optionnel — sinon display:none)
	// 			welcome.remove();
	// 			document.body.classList.remove('transition-lock');
	// 		};
	// 		welcome.addEventListener('transitionend', done, { once: true });
	// 	}

	// 	// Démarre automatiquement après X ms
	// 	const AUTO_DELAY_MS = 2200; // ajuste à ton goût
	// 	setTimeout(revealPager, AUTO_DELAY_MS);

	// 	// Et un “Tap pour continuer” au cas où
	// 	welcome.addEventListener('click', revealPager, { once: true });
	// })();
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

	function openUrl(u){
		if (!u) return;
		const url = /^https?:\/\//i.test(u) ? u : ('https://' + u);

		const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
			|| (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

		// iOS/PWA : ouvrir une fenêtre liée au geste utilisateur
		try {
			if (isIOS) {
				const w = window.open('about:blank', '_blank');
				if (w) { w.location.href = url; return; }
			}
		} catch(_) {}

		// Desktop / Android (ou fallback iOS)
		try { window.open(url, '_blank', 'noopener'); return; } catch(_) {}
		try { window.open(url, '_top'); return; } catch(_) {}
		try { window.location.assign(url); } catch(_) {}
	}

	function openUrlInNavigator(url) {
	if (!url) return;

	// Vérifie si on est dans une PWA iOS
	const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
		|| (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
	const isStandalone = window.navigator.standalone === true
		|| (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

	// Cas iOS PWA → créer un lien temporaire pour forcer Safari
	// if (isIOS && isStandalone) {
	// 	const a = document.createElement('a');
	// 	a.href = url;
	// 	a.target = '_blank';
	// 	a.rel = 'noopener,noreferrer';
	// 	// important : il faut un geste utilisateur pour que le click() fonctionne
	// 	a.style.display = 'none';
	// 	document.body.appendChild(a);
	// 	a.click();
	// 	document.body.removeChild(a);
	// 	return;
	// }

	// Sinon, comportement classique
	try { window.open(url, '_blank', 'noopener'); }
	catch { window.location.assign(url); }
	}	
	
	function wireCatalogButtons(){
		document.querySelectorAll('.catalog-btn[data-url]').forEach(btn => {
			// Est-ce bien un “button” cliquable
			btn.type = 'button';
			btn.addEventListener('click', (e) => {
				e.stopPropagation(); // évite d’interférer avec le swipe
				const raw = (btn.dataset.url || '').trim();
				if (!raw) return;
				openUrlInNavigator(raw);
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

