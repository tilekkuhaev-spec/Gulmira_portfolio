(() => {
  'use strict';
  const documents = window.PORTFOLIO_DOCUMENTS || [];
  const categories = {
    teacher: 'Мұғалім жетістіктері',
    students: 'Оқушы жетістіктері',
    qualification: 'Біліктілік',
    publications: 'Жарияланымдар',
    project: 'Авторлық жұмыс'
  };
  const $ = (id) => document.getElementById(id);
  const grid = $('document-grid');
  const search = $('document-search');
  const sort = $('document-sort');
  const filters = Array.from(document.querySelectorAll('[data-category]'));
  const viewer = $('document-viewer');
  const pageImage = $('document-page');
  const pageStage = $('page-stage');
  let category = 'all';
  let visibleCount = 12;
  let currentDocument = null;
  let currentPage = 1;
  let zoom = 100;
  let rotation = 0;
  let lastTrigger = null;
  let imageRequest = 0;

  // Escape catalogue strings before inserting them into generated markup.
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const normalize = (value) => String(value).normalize('NFKC').toLocaleLowerCase('kk-KZ').replace(/ё/g, 'е').replace(/[\s_-]+/g, ' ').trim();
  const size = (bytes) => bytes < 1000000 ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : `${(bytes / 1000000).toFixed(1).replace('.', ',')} МБ`;
  const downloadIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5"/></svg>';

  function matchingDocuments() {
    const tokens = normalize(search.value).split(' ').filter(Boolean);
    let matches = documents.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      const haystack = normalize(`${item.title} ${item.originalName} ${categories[item.category]}`);
      return tokens.every((token) => haystack.includes(token));
    });
    if (sort.value === 'title') matches = matches.slice().sort((a, b) => a.title.localeCompare(b.title, 'kk-KZ'));
    return matches;
  }

  function renderCatalogue(restoreFocusAt) {
    const matches = matchingDocuments();
    const visible = matches.slice(0, visibleCount);
    grid.innerHTML = visible.map((item) => `<article class="document-card">
      <button class="document-preview" data-open-doc="${item.id}" type="button" aria-label="Құжатты қарау: ${escape(item.title)}"><span class="doc-number" aria-hidden="true">${String(item.number).padStart(2, '0')}</span><img src="${item.thumb}" alt="" width="480" height="340" loading="lazy" decoding="async"><span class="preview-open-icon" aria-hidden="true">↗</span></button>
      <div class="card-body"><p class="card-category">${escape(categories[item.category])}</p><h3><button class="card-title-button" type="button" data-open-doc="${item.id}">${escape(item.title)}</button></h3><div class="card-footer"><span class="card-meta">PDF · ${item.pages} бет · ${size(item.bytes)}</span><div class="card-actions"><button class="card-view-link" type="button" data-open-doc="${item.id}" aria-label="${escape(item.title)} — қарау">Қарау ↗</button><a class="card-download" href="${item.pdf}" download="${escape(item.originalName)}" aria-label="PDF жүктеу: ${escape(item.title)}">${downloadIcon}</a></div></div></div>
    </article>`).join('');
    $('results-status').textContent = matches.length ? `${matches.length} құжаттың ${visible.length} құжаты көрсетілді` : '0 құжат табылды';
    $('empty-state').hidden = matches.length > 0;
    const remaining = matches.length - visible.length;
    $('load-more').hidden = remaining <= 0;
    $('load-more').innerHTML = `Тағы ${Math.min(12, remaining)} құжат көрсету <span aria-hidden="true">↓</span>`;
    if (restoreFocusAt !== undefined && visible[restoreFocusAt]) {
      grid.querySelector(`[data-open-doc="${visible[restoreFocusAt].id}"]`).focus({preventScroll: true});
    }
  }

  filters.forEach((button) => button.addEventListener('click', () => {
    category = button.dataset.category;
    visibleCount = 12;
    filters.forEach((filter) => {
      const active = filter === button;
      filter.classList.toggle('is-active', active);
      filter.setAttribute('aria-pressed', String(active));
    });
    renderCatalogue();
  }));
  search.addEventListener('input', () => { visibleCount = 12; renderCatalogue(); });
  sort.addEventListener('change', () => { visibleCount = 12; renderCatalogue(); });
  $('reset-search').addEventListener('click', () => {
    search.value = '';
    sort.value = 'default';
    filters[0].click();
    search.focus();
  });
  $('load-more').addEventListener('click', () => {
    const previousCount = visibleCount;
    visibleCount += 12;
    renderCatalogue(previousCount);
  });

  function updateGeometry() {
    const naturalWidth = pageImage.naturalWidth || 1;
    const naturalHeight = pageImage.naturalHeight || 1;
    const sideways = rotation % 180 !== 0;
    $('page-frame').style.aspectRatio = sideways ? `${naturalHeight} / ${naturalWidth}` : `${naturalWidth} / ${naturalHeight}`;
    pageImage.style.width = `${sideways ? (100 * naturalWidth / naturalHeight) : 100}%`;
    pageImage.style.setProperty('--rotation', `${rotation}deg`);
    pageStage.style.width = `${zoom}%`;
    pageStage.style.maxWidth = `${920 * zoom / 100}px`;
    $('zoom-reset').textContent = `${zoom}%`;
    $('zoom-out').disabled = zoom <= 75;
    $('zoom-in').disabled = zoom >= 250;
  }

  function showPage() {
    const request = ++imageRequest;
    zoom = 100;
    rotation = 0;
    $('page-indicator').textContent = `${currentPage} / ${currentDocument.pages}`;
    $('previous-page').disabled = currentPage <= 1;
    $('next-page').disabled = currentPage >= currentDocument.pages;
    $('page-error').hidden = true;
    $('page-loading').hidden = false;
    pageStage.hidden = true;
    $('page-scroll').scrollTop = 0;
    $('page-scroll').scrollLeft = 0;
    const url = `${currentDocument.previewBase}page-${String(currentPage).padStart(2, '0')}.webp`;
    pageImage.alt = `${currentDocument.title}, ${currentPage}-бет, барлығы ${currentDocument.pages} бет`;
    pageImage.onload = () => {
      if (request !== imageRequest || !currentDocument) return;
      $('page-loading').hidden = true;
      pageStage.hidden = false;
      updateGeometry();
    };
    pageImage.onerror = () => {
      if (request !== imageRequest || !currentDocument) return;
      $('page-loading').hidden = true;
      pageStage.hidden = true;
      $('page-error').hidden = false;
    };
    pageImage.src = url;
    updateGeometry();
  }

  function openDocument(id, trigger) {
    const item = documents.find((entry) => entry.id === id);
    if (!item) return;
    lastTrigger = trigger;
    currentDocument = item;
    currentPage = 1;
    $('viewer-title').textContent = item.title;
    $('viewer-category').textContent = categories[item.category];
    $('open-pdf').href = item.pdf;
    $('download-pdf').href = item.pdf;
    $('download-pdf').download = item.originalName;
    $('viewer-file-info').textContent = `PDF · ${item.pages} бет · ${size(item.bytes)}`;
    if (typeof viewer.showModal === 'function') viewer.showModal();
    else viewer.setAttribute('open', '');
    document.body.classList.add('modal-open');
    showPage();
    $('close-viewer').focus({preventScroll: true});
  }

  function cleanupViewer() {
    ++imageRequest;
    currentDocument = null;
    pageImage.onload = null;
    pageImage.onerror = null;
    document.body.classList.remove('modal-open');
    if (lastTrigger && lastTrigger.isConnected) lastTrigger.focus({preventScroll: true});
    lastTrigger = null;
  }
  function closeViewer() {
    if (typeof viewer.close === 'function') viewer.close();
    else { viewer.removeAttribute('open'); cleanupViewer(); }
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-open-doc]');
    if (trigger) openDocument(trigger.dataset.openDoc, trigger);
  });
  $('close-viewer').addEventListener('click', closeViewer);
  viewer.addEventListener('close', cleanupViewer);
  viewer.addEventListener('click', (event) => {
    if (event.target === viewer) {
      const rect = viewer.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeViewer();
    }
  });
  $('previous-page').addEventListener('click', () => { if (currentDocument && currentPage > 1) { currentPage--; showPage(); } });
  $('next-page').addEventListener('click', () => { if (currentDocument && currentPage < currentDocument.pages) { currentPage++; showPage(); } });
  $('zoom-in').addEventListener('click', () => { zoom = Math.min(250, zoom + 25); updateGeometry(); });
  $('zoom-out').addEventListener('click', () => { zoom = Math.max(75, zoom - 25); updateGeometry(); });
  $('zoom-reset').addEventListener('click', () => { zoom = 100; updateGeometry(); $('page-scroll').scrollLeft = 0; });
  $('rotate-page').addEventListener('click', () => { rotation = (rotation + 90) % 360; updateGeometry(); });
  viewer.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' && currentDocument && currentPage > 1) { event.preventDefault(); currentPage--; showPage(); }
    if (event.key === 'ArrowRight' && currentDocument && currentPage < currentDocument.pages) { event.preventDefault(); currentPage++; showPage(); }
  });

  const menuToggle = document.querySelector('.menu-toggle');
  const navigation = $('main-nav');
  function closeMenu() {
    navigation.classList.remove('is-open');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Мәзірді ашу');
  }
  menuToggle.addEventListener('click', () => {
    const open = menuToggle.getAttribute('aria-expanded') !== 'true';
    navigation.classList.toggle('is-open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Мәзірді жабу' : 'Мәзірді ашу');
  });
  navigation.addEventListener('click', (event) => { if (event.target.closest('a')) closeMenu(); });
  document.addEventListener('click', (event) => { if (!event.target.closest('.site-header')) closeMenu(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });
  window.addEventListener('resize', () => { if (window.innerWidth > 700) closeMenu(); });

  renderCatalogue();
})();
