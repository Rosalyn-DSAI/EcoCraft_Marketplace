/* EcoCraft coursework UI. All write actions call Flask; browser never talks to Atlas. */
(() => {
  'use strict';
  // Tab-local identity and UI caches; access tokens are never stored in browser persistence.
  const state = {
    token: null,
    user: null,
    products: [],
    homeProducts: [],
    myProducts: [],
    cart: null,
    orders: [],
    sales: [],
    catalogPage: 1,
    catalogHasNext: false,
    catalogMode: 'all',
    catalogArtistId: '',
    detailOrigin: 'home',
  };
  let reviewedProduct = null,
    reviewRequest = 0;
  let cartBusy = false,
    cartVersion = 0;
  function clearReviews() {
    reviewedProduct = null;
    reviewRequest++;
  }
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );
  const money = (v) => {
    const n = Number(v);
    return Number.isFinite(n)
      ? new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
        }).format(n)
      : '—';
  };
  // Shows an element for two seconds; showing it again restarts the countdown.
  const flashTimers = new WeakMap();
  function flashMessage(el) {
    clearTimeout(flashTimers.get(el));
    el.hidden = false;
    flashTimers.set(
      el,
      setTimeout(() => {
        el.hidden = true;
        flashTimers.delete(el);
      }, 2000),
    );
  }
  function clearFlash(el) {
    clearTimeout(flashTimers.get(el));
    flashTimers.delete(el);
    el.hidden = true;
  }
  const notify = (msg, ok = true) => {
    const n = $('notice');
    n.textContent = msg;
    n.className = 'notice ' + (ok ? 'ok' : 'bad');
    flashMessage(n);
    n.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const formData = (f) => Object.fromEntries(new FormData(f).entries());
  const comma = (s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  // Practice codes match the backend allowlist (SUSTAINABILITY_PRACTICES in domain/sustainability.py).
  const SUSTAINABILITY_PRACTICES = {
    recycled_materials: 'Recycled materials',
    upcycled: 'Upcycled',
    organic: 'Organic',
    locally_sourced: 'Locally sourced',
    zero_waste_packaging: 'Zero-waste packaging',
    handmade_small_batch: 'Handmade, small batch',
    non_toxic_finishes: 'Non-toxic finishes',
  };
  const practiceCheckboxes = (selected = []) =>
    Object.entries(SUSTAINABILITY_PRACTICES)
      .map(
        ([code, label]) =>
          `<label class="practice-option"><input type="checkbox" value="${code}"${selected.includes(code) ? ' checked' : ''}> ${esc(label)}</label>`,
      )
      .join('');
  // All API calls use JSON and send the session token when signed in.
  async function call(path, method = 'GET', body) {
    const h = { Accept: 'application/json' };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (state.token) h.Authorization = 'Bearer ' + state.token;
    const response = await fetch('/api' + path, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw Error('API returned a non-JSON response');
    }
    if (!response.ok)
      throw Error(data?.error?.message || `HTTP ${response.status}`);
    return data;
  }
  async function run(fn) {
    try {
      await fn();
    } catch (err) {
      notify(err?.message || 'Unexpected error', false);
    }
  }
  function showHomeHero(home) {
    $('home-hero').hidden = !home;
    $('page-banner').hidden = home;
    $('dashboard-nav').hidden = home || !!state.user;
  }
  function page(requested, refreshHomeView = true) {
    const name =
      requested === 'dashboard' && state.user?.role === 'artist'
        ? 'artist-dashboard'
        : requested;
    const navName = name === 'artist-dashboard' ? 'dashboard' : name;
    if (name.startsWith('admin-') && state.user?.role !== 'admin') {
      notify('Sign in as an administrator to open this page.', false);
      return;
    }
    if (name.startsWith('customer-') && state.user?.role !== 'customer') {
      notify('Sign in as a customer to open this page.', false);
      page('auth');
      return;
    }
    if (
      (name === 'artist-profile' ||
        name === 'artist-dashboard' ||
        name === 'artist-insights' ||
        name === 'artist-orders' ||
        name === 'artist-add-product') &&
      state.user?.role !== 'artist'
    ) {
      notify('Sign in as an artist to open this page.', false);
      return;
    }
    clearReviews();
    const admin = state.user?.role === 'admin';
    const artistPage =
      state.user?.role === 'artist' &&
      [
        'artist-dashboard',
        'artist-profile',
        'artist-insights',
        'artist-orders',
        'artist-add-product',
      ].includes(name);
    const fullWidth =
      [
        'about',
        'build',
        'data',
        'contributors',
        'auth',
        'artist-profile',
      ].includes(name) ||
      artistPage ||
      (admin &&
        [
          'dashboard',
          'admin-profile',
          'admin-artists',
          'admin-products',
          'admin-analytics',
        ].includes(name)) ||
      (state.user?.role === 'customer' &&
        ['dashboard', 'customer-cart', 'customer-orders'].includes(name));
    $('catalog-filters').hidden = fullWidth;
    $('page-layout').classList.toggle('project-layout', fullWidth);
    document
      .querySelectorAll('.page')
      .forEach((p) => (p.hidden = p.id !== 'page-' + name));
    document
      .querySelectorAll('.nav-tab')
      .forEach((b) => b.classList.toggle('active', b.dataset.page === navName));
    showHomeHero(name === 'catalog');
    $('auth-nav').hidden = name === 'auth';
    $('insights-nav').hidden = state.user?.role !== 'artist';
    $('orders-nav').hidden = state.user?.role !== 'artist';
    $('cart-nav').hidden = state.user?.role !== 'customer';
    $('customer-orders-nav').hidden = state.user?.role !== 'customer';
    $('sign-out').hidden = !state.user;
    if (name === 'auth') $('dashboard-nav').hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (name === 'catalog') showCatalogHome(refreshHomeView);
    if (name === 'admin-analytics') window.MarketPulse?.show({ call, notify });
    if (name === 'artist-insights')
      window.ArtistInsights?.show({ call, notify });
    if (
      name === 'dashboard' ||
      name === 'artist-dashboard' ||
      name === 'admin-profile' ||
      name === 'artist-profile'
    )
      run(refreshDashboard);
    if (name === 'admin-artists') run(refreshArtists);
    if (name === 'admin-products') run(refreshModeration);
    if (name === 'artist-orders') run(refreshSales);
    if (name === 'customer-cart') {
      renderCheckoutAddress();
    }
    if (name === 'customer-orders') run(refreshOrders);
  }
  // Navigation and account forms. Capture currentTarget before asynchronous work invalidates it.
  document.querySelectorAll('[data-page]').forEach((b) =>
    b.addEventListener('click', (event) => {
      if (b.tagName === 'A') event.preventDefault();
      page(b.dataset.page);
    }),
  );
  $('home-logo').addEventListener('click', (event) => {
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    page(state.user?.role === 'admin' ? 'dashboard' : 'catalog');
  });
  $('go-login').onclick = () => page('auth');
  $('register-role').onchange = () => {
    const artist = $('register-role').value === 'artist';
    $('origin-wrap').hidden = !artist;
    $('origin-wrap').querySelector('textarea').required = artist;
  };
  $('register-form').onsubmit = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    run(async () => {
      const data = formData(form);
      if (data.role === 'customer') delete data.originStory;
      const out = await call('/auth/register', 'POST', data);
      notify(out.message);
      form.reset();
      $('origin-wrap').hidden = true;
      page('auth');
    });
  };
  $('login-form').onsubmit = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    run(async () => {
      const result = await call('/auth/login', 'POST', formData(form));
      state.token = result.accessToken;
      state.user = result.user;
      state.cart = null;
      updateCartControls();
      updateCartBadge();
      form.reset();
      $('auth-nav').textContent = 'Account';
      const accountPage =
        { admin: 'admin-profile', artist: 'artist-profile' }[
          result.user.role
        ] || 'dashboard';
      const landing =
        { admin: 'dashboard', artist: 'dashboard' }[result.user.role] ||
        'catalog';
      $('auth-nav').dataset.page = accountPage;
      if (result.user.role === 'customer') await refreshCart();
      $('notice').hidden = true;
      $('sign-in-message').textContent =
        `Signed in as ${result.user.personalInfo.firstName} (${result.user.role})`;
      flashMessage($('sign-in-message'));
      page(landing);
    });
  };
  $('sign-out').onclick = () => {
    clearFlash($('sign-in-message'));
    state.token = null;
    state.user = null;
    state.cart = null;
    state.orders = [];
    updateCartControls();
    updateCartBadge();
    $('auth-nav').textContent = 'Sign in / Sign up';
    $('auth-nav').dataset.page = 'auth';
    notify('Signed out from this browser tab');
    page('catalog');
  };
  $('search-form').onsubmit = (e) => {
    e.preventDefault();
    if ($('page-catalog').hidden || $('catalog-view').hidden) {
      page('catalog', false);
      $('catalog-home').hidden = true;
      $('catalog-view').hidden = false;
      showHomeHero(false);
      $('collection-title').textContent = 'All products';
    }
    state.catalogPage = 1;
    state.catalogHasNext = false;
    run(refreshCatalog);
  };
  function resetFilters() {
    $('search').value = '';
    setChecked('category-checks', []);
    setChecked('material-checks', []);
    setChecked('practice-checks', []);
    $('sort').value = 'newest';
    $('min-price').value = '';
    $('max-price').value = '';
  }
  function checkedValues(id) {
    return [...$(id).querySelectorAll('input:checked')].map((i) => i.value);
  }
  function setChecked(id, values) {
    $(id)
      .querySelectorAll('input[type="checkbox"]')
      .forEach((i) => (i.checked = values.includes(i.value)));
  }
  function renderChecks(id, legend, values) {
    const keep = checkedValues(id);
    $(id).innerHTML =
      `<legend>${esc(legend)}</legend>` +
      values
        .map(
          (v) =>
            `<label><input type="checkbox" value="${esc(v)}"${keep.includes(v) ? ' checked' : ''} /> ${esc(v)}</label>`,
        )
        .join('');
  }
  $('clear-search').onclick = () => {
    resetFilters();
    state.catalogPage = 1;
    state.catalogHasNext = false;
    if (!$('page-catalog').hidden && !$('catalog-view').hidden)
      run(refreshCatalog);
  };
  $('catalog-home-button').onclick = () => showCatalogHome();
  $('catalog-prev').onclick = () => {
    if (state.catalogPage > 1) {
      state.catalogPage -= 1;
      run(refreshCatalog);
    }
  };
  $('catalog-next').onclick = () => {
    if (state.catalogHasNext) {
      state.catalogPage += 1;
      run(refreshCatalog);
    }
  };
  function showCatalogHome(refresh = true) {
    clearReviews();
    showHomeHero(true);
    state.catalogMode = 'all';
    state.catalogArtistId = '';
    $('catalog-home').hidden = false;
    $('catalog-view').hidden = true;
    $('catalog-filters').hidden = false;
    $('product-detail-view').hidden = true;
    $('reviews-panel').hidden = true;
    if (refresh === true) run(refreshHome);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function openCollection(
    title,
    { category = '', artistId = '' } = {},
  ) {
    clearReviews();
    showHomeHero(false);
    $('catalog-home').hidden = true;
    $('catalog-view').hidden = false;
    $('catalog-filters').hidden = false;
    $('product-detail-view').hidden = true;
    $('reviews-panel').hidden = true;
    $('collection-title').textContent = title;
    resetFilters();
    if (category) setChecked('category-checks', [category]);
    state.catalogMode = 'all';
    state.catalogArtistId = artistId;
    state.catalogPage = 1;
    state.catalogHasNext = false;
    run(refreshCatalog);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function openMakers() {
    clearReviews();
    showHomeHero(false);
    $('catalog-home').hidden = true;
    $('catalog-view').hidden = false;
    $('catalog-filters').hidden = true;
    $('product-detail-view').hidden = true;
    $('reviews-panel').hidden = true;
    $('collection-title').textContent = 'Meet the Makers';
    state.catalogMode = 'makers';
    state.catalogArtistId = '';
    run(refreshMakers);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function refreshMakers() {
    const data = await call('/artists/makers?limit=100');
    const makers = data.makers || [];
    $('catalog-results').textContent = `${makers.length} maker${makers.length === 1 ? '' : 's'} listed`;
    $('catalog-pagination').hidden = true;
    $('product-list').innerHTML = makers.length
      ? renderMakerCards(makers)
      : '<p class="empty">No makers are listed yet.</p>';
  }
  const productPlaceholder =
    '<span class="product-placeholder" aria-hidden="true"></span>';
  const productImage = (p) =>
    p.images?.[0]
      ? `<img src="${esc(p.images[0])}" alt="${esc(p.title)}" loading="lazy">`
      : productPlaceholder;
  // Image load errors do not bubble, so this listens in the capture phase.
  document.addEventListener(
    'error',
    (event) => {
      const img = event.target;
      if (img instanceof HTMLImageElement && img.closest('.product-img'))
        img.outerHTML = productPlaceholder;
    },
    true,
  );
  // Finds where the visual interest sits in a photo (weighted centroid of edge
  // strength). Cards use it to crop around the piece instead of the frame centre.
  const FOCUS_SAMPLE = 64;
  const focusCache = new Map();
  function measureFocus(img) {
    const scale = FOCUS_SAMPLE / Math.max(img.naturalWidth, img.naturalHeight);
    const w = Math.max(3, Math.round(img.naturalWidth * scale));
    const h = Math.max(3, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    // Throws a SecurityError when the image is cross-origin without CORS.
    const { data } = ctx.getImageData(0, 0, w, h);
    const luma = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++)
      luma[i] =
        0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    let total = 0;
    let sx = 0;
    let sy = 0;
    for (let y = 0; y < h - 1; y++)
      for (let x = 0; x < w - 1; x++) {
        const i = y * w + x;
        const edge =
          Math.abs(luma[i + 1] - luma[i]) + Math.abs(luma[i + w] - luma[i]);
        const weight = edge * edge;
        total += weight;
        sx += weight * x;
        sy += weight * y;
      }
    if (!total) return { x: 0.5, y: 0.5 };
    // Blend toward the centre so one stray edge cannot push the crop to a corner.
    return {
      x: 0.7 * (sx / total / (w - 1)) + 0.15,
      y: 0.7 * (sy / total / (h - 1)) + 0.15,
    };
  }
  function focusFor(img) {
    const src = img.currentSrc || img.src;
    if (!focusCache.has(src))
      focusCache.set(
        src,
        (async () => {
          try {
            return measureFocus(img);
          } catch {
            // Retry with CORS so the pixels can be read; otherwise keep the centre.
            const probe = new Image();
            probe.crossOrigin = 'anonymous';
            probe.src = src;
            await probe.decode();
            return measureFocus(probe);
          }
        })().catch(() => ({ x: 0.5, y: 0.5 })),
      );
    return focusCache.get(src);
  }
  // Converts the focal point into object-position so it lands in the middle of the box.
  function placeFocus(img) {
    const box = img.parentElement;
    const fx = Number(img.dataset.fx);
    const fy = Number(img.dataset.fy);
    if (!box || !img.naturalWidth || !img.dataset.fx) return;
    const cw = box.clientWidth;
    const ch = box.clientHeight;
    const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
    const rw = img.naturalWidth * scale;
    const rh = img.naturalHeight * scale;
    const percent = (container, rendered, focus) => {
      if (rendered <= container) return 50;
      const offset = Math.min(
        0,
        Math.max(container - rendered, container / 2 - focus * rendered),
      );
      return (offset / (container - rendered)) * 100;
    };
    img.style.objectPosition = `${percent(cw, rw, fx)}% ${percent(ch, rh, fy)}%`;
  }
  document.addEventListener(
    'load',
    async (event) => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement) || !img.closest('.product-img'))
        return;
      const focus = await focusFor(img);
      img.dataset.fx = focus.x;
      img.dataset.fy = focus.y;
      placeFocus(img);
    },
    true,
  );
  window.addEventListener('resize', () => {
    document.querySelectorAll('.product-img img[data-fx]').forEach(placeFocus);
  });
  function cartControl(product) {
    const quantity =
      state.cart?.items.find((item) => item.productId === product._id)
        ?.quantity || 0;
    const stock = Number(product.inventory?.quantityAvailable) || 0;
    const disabled = cartBusy ? 'disabled' : '';
    const atStock = quantity >= Math.min(100, stock) ? 'disabled' : '';
    return quantity
      ? `<span class="cart-stepper"><button class="secondary" type="button" data-cart-decrease="${esc(product._id)}" aria-label="Decrease quantity of ${esc(product.title)}" ${disabled}>−</button><span aria-label="Quantity in cart">${esc(quantity)}</span><button class="secondary" type="button" data-cart-increase="${esc(product._id)}" aria-label="Increase quantity of ${esc(product.title)}" ${disabled || atStock}>+</button></span>`
      : `<button class="secondary" type="button" data-add="${esc(product._id)}" ${cartBusy || stock <= 0 ? 'disabled' : ''}>Add to cart</button>`;
  }
  function updateCartControls() {
    $('page-catalog')
      .querySelectorAll('[data-cart-control]')
      .forEach((control) => {
        const product = findProduct(control.dataset.cartControl);
        if (product) control.innerHTML = cartControl(product);
      });
  }
  function ratingSummary(p) {
    if (!p.reviewCount) return '<span class="hint">No reviews yet</span>';
    const full = Math.round(p.averageRating);
    return `<span class="rating-stars" aria-hidden="true">${'★'.repeat(full)}${'☆'.repeat(5 - full)}</span> <span class="hint">${esc(p.averageRating.toFixed(1))} (${esc(p.reviewCount)})</span>`;
  }
  function renderProductCards(products) {
    return products
      .map(
        (p) =>
          `<article class="product-card"><div class="product-img">${productImage(p)}</div><h3><a href="#product-detail-view" class="product-title" data-details="${esc(p._id)}">${esc(p.title)}</a></h3><div class="category">${esc(p.category)}</div><div class="product-rating">Rating: ${ratingSummary(p)}</div><div class="card-bottom"><span class="price">${money(p.price)}</span><span data-cart-control="${esc(p._id)}">${cartControl(p)}</span></div></article>`,
      )
      .join('');
  }
  function renderRail(id, products, emptyText) {
    $(id).innerHTML = products.length
      ? renderProductCards(products)
      : `<p class="empty">${emptyText}</p>`;
  }
  function renderMakerCards(makers) {
    if (!makers.length)
      return '<p class="empty">No makers are listed yet.</p>';
    return makers
      .map((maker) => {
        const initials = maker.name
          .split(/\s+/)
          .map((part) => part[0] || '')
          .join('')
          .slice(0, 2)
          .toUpperCase();
        const photo = maker.image
          ? `<img src="${esc(maker.image)}" alt="${esc(maker.name)}" loading="lazy">`
          : `<span>${esc(initials)}</span>`;
        return `<button class="maker-card panel" type="button" data-maker="${esc(maker.id)}" data-maker-name="${esc(maker.name)}" aria-label="See products by ${esc(maker.name)}"><span class="maker-photo">${photo}</span><span class="maker-body"><span class="maker-name">${esc(maker.name)}</span><span class="maker-story">${esc(maker.originStory)}</span><span class="maker-sales">${maker.inCarts} in carts · ${maker.soldLast30Days} sold in the last 30 days</span></span></button>`;
      })
      .join('');
  }
  async function refreshHome() {
    const [featured, summary, makers, materialList] = await Promise.all([
      call('/products?page=1'),
      call('/analytics/categories'),
      call('/artists/makers?limit=10').catch(() => ({ makers: [] })),
      call('/analytics/materials').catch(() => ({ materials: [] })),
    ]);
    state.homeProducts = [...featured.products];
    renderRail(
      'featured-rail',
      featured.products,
      'No approved products are available yet.',
    );
    $('makers-rail').innerHTML = renderMakerCards(makers.makers || []);
    const categories = (summary.categories || []).slice();
    renderChecks(
      'category-checks',
      'Category',
      categories.map((item) => item.category),
    );
    renderChecks('material-checks', 'Materials', materialList.materials || []);
    for (let i = 0; i < Math.min(2, categories.length); i++) {
      const selected = i + Math.floor(Math.random() * (categories.length - i));
      [categories[i], categories[selected]] = [
        categories[selected],
        categories[i],
      ];
    }
    categories.splice(2);
    const collections = await Promise.all(
      categories.map(async (item) => ({
        category: item.category,
        ...(await call(
          '/products?' +
            new URLSearchParams({
              search: '',
              category: item.category,
              page: '1',
            }),
        )),
      })),
    );
    for (const collection of collections)
      state.homeProducts.push(...collection.products);
    $('theme-collections').innerHTML = collections.length
      ? collections
          .map(
            (collection) =>
              `<section class="theme-row"><div class="section-heading inner"><h4><button class="collection-title" type="button" data-collection-category="${esc(collection.category)}">${esc(collection.category)}</button></h4></div><div class="product-rail" tabindex="0" aria-label="${esc(collection.category)} products">${collection.products.length ? renderProductCards(collection.products) : '<p class="empty">No products in this collection yet.</p>'}</div></section>`,
          )
          .join('')
      : '<p class="empty">No product categories are available yet.</p>';
  }
  function findProduct(id) {
    return [...state.products, ...state.homeProducts].find(
      (product) => product._id === id,
    );
  }  function showProductDetails(
    product,
    origin = $('catalog-view').hidden ? 'home' : 'collection',
  ) {
    clearReviews();
    state.detailOrigin = origin;
    showHomeHero(false);
    $('catalog-home').hidden = true;
    $('catalog-view').hidden = true;
    $('reviews-panel').hidden = true;
    if (state.user?.role === 'artist') {
      $('page-layout').classList.add('project-layout');
    }
    $('catalog-filters').hidden = true;
    $('product-detail-view').hidden = false;
    $('product-detail-title').textContent = product.title;
    const field = (label, value) =>
      value ? `<p><strong>${label}:</strong> ${esc(value)}</p>` : '';
    const images = (product.images || [])
      .map(
        (src, index) =>
          `<div class="product-detail-image"><img src="${esc(src)}" alt="${esc(product.title)}${index ? ` - image ${index + 1}` : ''}"></div>`,
      )
      .join('');
    const sustainability = product.sustainability || {};
    const practices = (sustainability.practices || [])
      .map((code) => SUSTAINABILITY_PRACTICES[code])
      .filter(Boolean)
      .join(', ');
    const certifications = (sustainability.certifications || [])
      .map(
        (c) =>
          `${c.name} (${c.issuer}), ${c.verified ? 'verified by EcoCraft' : 'artist-declared'}`,
      )
      .join('; ');
    $('product-detail-content').innerHTML =
      `<div class="product-detail-layout"><div class="product-detail-images">${images || `<div class="product-img">${productPlaceholder}</div>`}</div><div><p class="kicker">${esc(product.category)}</p><p>${esc(product.description)}</p>${field('Materials', (product.materials || []).join(', '))}${field('Stock', product.inventory?.quantityAvailable == null ? '' : String(product.inventory.quantityAvailable))}${field('Dimensions', product.dimensions)}${field('Care instructions', product.careInstructions)}${field('Tags', (product.tags || []).join(', '))}${field('Sustainability practices', practices)}${field('Sustainability', sustainability.summary)}${field('Certifications', certifications)}${field('Return policy', product.returnPolicy)}${field('Copyright', product.copyrightText)}<p class="product-rating">Rating: ${ratingSummary(product)}</p><p class="price">${money(product.price)}</p><div class="detail-actions">${state.user?.role === 'artist' && product.active !== false ? `<button class="outline" data-edit-product="${esc(product._id)}">Edit product</button><button class="danger-btn" data-delete-product="${esc(product._id)}">Delete product</button>` : ''}${['admin', 'artist'].includes(state.user?.role) ? '' : `<span data-cart-control="${esc(product._id)}">${cartControl(product)}</span>`}<button class="outline" data-reviews="${esc(product._id)}">Read reviews</button></div></div></div>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('product-detail-title').focus();
  }
  $('product-detail-back').onclick = () => {
    clearReviews();
    $('product-detail-view').hidden = true;
    $('reviews-panel').hidden = true;
    if (state.detailOrigin === 'curate') {
      page('admin-products');
      return;
    }
    if (state.detailOrigin === 'artist') {
      page('dashboard');
      return;
    }
    showHomeHero(state.detailOrigin === 'home');
    $('catalog-filters').hidden = false;
    if (state.detailOrigin === 'collection') $('catalog-view').hidden = false;
    else $('catalog-home').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  function handleCatalogAction(event) {
    const details = event.target.closest('[data-details]'),
      add = event.target.closest('[data-add]'),
      increase = event.target.closest('[data-cart-increase]'),
      decrease = event.target.closest('[data-cart-decrease]'),
      review = event.target.closest('[data-reviews]');
    if (details) {
      event.preventDefault();
      const product = findProduct(details.dataset.details);
      if (product) showProductDetails(product);
      else
        notify(
          'Product details are no longer available. Please refresh the catalog.',
          false,
        );
    }
    if (add || increase || decrease)
      run(() =>
        changeCatalogCart(
          add?.dataset.add ||
            increase?.dataset.cartIncrease ||
            decrease.dataset.cartDecrease,
          decrease ? -1 : 1,
        ),
      );
    if (review) run(() => openReviews(review.dataset.reviews));
  }
  function handleCollectionAction(event) {
    const category = event.target.closest('[data-collection-category]'),
      all = event.target.closest('[data-collection-all]'),
      maker = event.target.closest('[data-maker]'),
      makers = event.target.closest('[data-makers-all]');
    if (category)
      openCollection(category.dataset.collectionCategory, {
        category: category.dataset.collectionCategory,
      });
    else if (all) openCollection('Thoughtful Finds');
    else if (maker)
      openCollection(`Products by ${maker.dataset.makerName}`, {
        artistId: maker.dataset.maker,
      });
    else if (makers) openMakers();
  }
  $('page-catalog').addEventListener('click', (event) => {
    handleCatalogAction(event);
    handleCollectionAction(event);
  });
  async function refreshCatalog() {
    if (state.catalogMode === 'makers') return;
    const search = $('search').value.trim(),
      categories = checkedValues('category-checks'),
      materials = checkedValues('material-checks'),
      practices = checkedValues('practice-checks'),
      sort = $('sort').value,
      minPrice = $('min-price').value.trim(),
      maxPrice = $('max-price').value.trim(),
      div = $('product-list'),
      pager = $('catalog-pagination'),
      meta = $('catalog-results');
    const params = new URLSearchParams({
      search,
      sort,
      minPrice,
      maxPrice,
      artistId: state.catalogArtistId,
      page: String(state.catalogPage),
    });
    categories.forEach((v) => params.append('category', v));
    materials.forEach((v) => params.append('material', v));
    practices.forEach((v) => params.append('practice', v));
    const data = await call('/products?' + params);
    state.products = data.products;
    state.homeProducts.push(...data.products);
    state.catalogPage = data.page;
    if (data.page > 1 && !data.products.length) {
      state.catalogPage = data.page - 1;
      await refreshCatalog();
      state.catalogHasNext = false;
      pager.hidden = false;
      $('catalog-next').hidden = true;
      $('catalog-page-label').textContent =
        `Page ${state.catalogPage} · end of catalog`;
      return;
    }
    state.catalogHasNext = data.products.length === data.pageSize;
    const filters = [
      search ? `Search: “${search}”` : null,
      categories.length ? `Category: ${categories.join(', ')}` : null,
      materials.length ? `Materials: ${materials.join(', ')}` : null,
      practices.length ? `Sustainability: ${practices.length} selected` : null,
      minPrice || maxPrice
        ? `Price: ${minPrice || 'any'} to ${maxPrice || 'any'}`
        : null,
    ].filter(Boolean);
    meta.textContent = `${data.products.length} product${data.products.length === 1 ? '' : 's'} shown on page ${data.page}${filters.length ? ` · ${filters.join(' · ')}` : ''}${state.catalogHasNext ? ' · more may be available' : ''}`;
    pager.hidden = data.page === 1 && !state.catalogHasNext;
    $('catalog-prev').hidden = data.page <= 1;
    $('catalog-next').hidden = !state.catalogHasNext;
    $('catalog-page-label').textContent = `Page ${data.page}`;
    div.innerHTML = data.products.length
      ? renderProductCards(data.products)
      : '<p class="empty">No approved products matched these filters. Try changing or clearing them.</p>';
  }
  // Public reviews and owner edits; numeric rating and comment are currently separate prompts.
  async function openReviews(productId) {
    reviewedProduct = productId;
    const request = ++reviewRequest;
    const data = await call('/products/' + productId + '/reviews');
    if (
      request !== reviewRequest ||
      $('product-detail-view').hidden ||
      $('page-catalog').hidden
    )
      return;
    $('reviews-panel').hidden = false;
    $('reviews-list').innerHTML = data.reviews.length
      ? data.reviews
          .map(
            (v) =>
              `<div class="record"><strong>${esc(v.rating)} / 5</strong><p>${esc(v.comment || 'No comment')}</p>${state.user?.id === v.customerId ? `<div class="actions"><button class="secondary" data-review-edit="${esc(v._id)}">Edit review</button><button class="danger-btn" data-review-delete="${esc(v._id)}">Delete review</button></div>` : ''}</div>`,
          )
          .join('')
      : '<p class="muted">No reviews yet.</p>';
    $('reviews-panel').scrollIntoView({ behavior: 'smooth' });
  }
  $('close-reviews').onclick = () => {
    $('reviews-panel').hidden = true;
    clearReviews();
  };
  $('reviews-list').onclick = (e) => {
    const edit = e.target.closest('[data-review-edit]'),
      del = e.target.closest('[data-review-delete]');
    if (edit)
      run(async () => {
        const productId = reviewedProduct,
          request = reviewRequest;
        const rating = prompt('Updated rating (1–5)');
        if (rating === null) return;
        const comment = prompt('Updated comment');
        if (comment === null) return;
        await call('/reviews/' + edit.dataset.reviewEdit, 'PATCH', {
          rating: Number(rating),
          comment,
        });
        notify('Review updated');
        if (request === reviewRequest) await openReviews(productId);
      });
    if (del)
      run(async () => {
        const productId = reviewedProduct,
          request = reviewRequest;
        if (!confirm('Delete this review?')) return;
        await call('/reviews/' + del.dataset.reviewDelete, 'DELETE');
        notify('Review deleted');
        if (request === reviewRequest) await openReviews(productId);
      });
  };

  // Reload the current profile before showing the role-specific workspace.
  async function refreshDashboard() {
    const logged = !!state.user,
      admin = state.user?.role === 'admin';
    $('login-prompt').hidden = logged;
    $('workspace').hidden = !logged;
    $('workspace-details').hidden = admin;
    $('admin-shortcuts').hidden = !admin;
    $('workspace-profile').hidden = state.user?.role === 'artist';
    $('workspace-title').textContent =
      state.user?.role === 'customer' ? 'My profile' : 'Marketplace workspace';
    $('identity').textContent = logged
      ? state.user.personalInfo.firstName + ' · ' + state.user.role
      : 'Not signed in';
    if (!logged) return;
    const profileHost =
      {
        admin: 'admin-profile',
        artist: 'artist-profile',
      }[state.user.role] || 'workspace-profile';
    $(profileHost).appendChild($('profile-panel'));
    const token = state.token;
    const me = await call('/auth/me');
    if (state.token !== token) return;
    state.user = me.user;
    renderAccount();
    $('admin-shortcuts').hidden = me.user.role !== 'admin';
    if (me.user.role === 'artist') await refreshMyProducts();
    if (me.user.role === 'customer') await refreshCart();
  }
  // Local photo previews release object URLs; uploading and saving the product are separate operations.
  let previewObjectUrl = null;
  function previewImage(url) {
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }
    const img = $('product-image-preview');
    img.hidden = !url;
    if (url) img.src = url;
    else img.removeAttribute('src');
  }
  $('product-image-file').onchange = () => {
    const file = $('product-image-file').files[0];
    $('product-image-url').value = '';
    $('product-image-remove').checked = false;
    previewImage('');
    if (file) {
      previewObjectUrl = URL.createObjectURL(file);
      $('product-image-preview').src = previewObjectUrl;
      $('product-image-preview').hidden = false;
    }
  };
  $('product-image-url').oninput = () => {
    $('product-image-file').value = '';
    $('product-image-remove').checked = false;
    const url = $('product-image-url').value.trim();
    previewImage(/^https:\/\/[^\s]+$/.test(url) ? url : '');
  };
  $('product-image-remove').onchange = () => {
    if ($('product-image-remove').checked) {
      $('product-image-file').value = '';
      $('product-image-url').value = '';
      previewImage('');
    }
  };
  // Use multipart without setting Content-Type so the browser supplies its boundary; server revalidates bytes.
  async function uploadPhoto(file) {
    if (file.size > 4 * 1024 * 1024)
      throw Error('Image must be 4 MB or smaller');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
      throw Error('Choose a PNG, JPEG, or WebP image');
    const body = new FormData();
    body.append('file', file);
    const response = await fetch('/api/products/image-upload', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer ' + state.token,
      },
      body,
      credentials: 'omit',
    });
    const data = await response.json();
    if (!response.ok)
      throw Error(data?.error?.message || 'Image upload failed');
    return data.url;
  }
  function addCertificationRow(values = {}) {
    const row = $('certification-template').content.firstElementChild.cloneNode(true);
    for (const key of ['name', 'issuer', 'certificateUrl'])
      row.querySelector(`[data-cert="${key}"]`).value = values[key] || '';
    $('certification-list').append(row);
  }
  // Builds the full sustainability object; the server replaces the whole object on every save.
  function collectSustainability() {
    const practices = [
      ...$('sustainability-practices').querySelectorAll('input:checked'),
    ].map((box) => box.value);
    const certifications = [
      ...$('certification-list').querySelectorAll('.certification-row'),
    ].map((row) => {
      const read = (key) => row.querySelector(`[data-cert="${key}"]`).value.trim();
      const cert = { name: read('name'), issuer: read('issuer') };
      if (!cert.name || !cert.issuer)
        throw Error('Each certification needs a name and issuer');
      const url = read('certificateUrl');
      if (url) {
        if (!/^https:\/\/[^\s]+$/.test(url))
          throw Error('Certificate link must start with https://');
        cert.certificateUrl = url;
      }
      return cert;
    });
    return {
      practices,
      summary: $('sustainability-summary').value.trim(),
      certifications,
    };
  }
  function setSustainabilityLocked(locked) {
    const fieldset = $('sustainability-practices').closest('fieldset');
    for (const el of fieldset.querySelectorAll('input, textarea, button'))
      el.disabled = locked;
    $('sustainability-locked').hidden = !locked;
  }
  function resetProduct() {
    const f = $('product-form');
    f.reset();
    previewImage('');
    $('certification-list').innerHTML = '';
    $('sustainability-practices').innerHTML = practiceCheckboxes();
    f.elements.namedItem('editingId').value = '';
    f.dataset.resubmit = '';
    setSustainabilityLocked(false);
    $('product-form-title').textContent = 'List a product';
    $('save-product').textContent = 'Submit for approval';
  }
  $('clear-product').onclick = resetProduct;
  $('sustainability-practices').innerHTML = practiceCheckboxes();
  $('add-certification').onclick = () => addCertificationRow();
  $('certification-list').onclick = (e) => {
    const remove = e.target.closest('[data-remove-certification]');
    if (remove) remove.closest('.certification-row').remove();
  };
  // Strip form-only image fields, prevent duplicate submits and preserve unchanged image arrays on edits.
  $('product-form').onsubmit = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    if ($('save-product').disabled) return;
    const d = formData(form);
    const id = d.editingId;
    const file = $('product-image-file').files[0];
    const imageUrl = $('product-image-url').value.trim();
    const removeImage = $('product-image-remove').checked;
    for (const key of ['editingId', 'imageFile', 'imageUrl', 'removeImage'])
      delete d[key];
    $('save-product').disabled = true;
    run(async () => {
      try {
        d.materials = comma(d.materials);
        d.tags = comma(d.tags || '');
        if ($('sustainability-locked').hidden)
          d.sustainability = collectSustainability();
        d.quantityAvailable = Number(d.quantityAvailable);
        if (!Number.isInteger(d.quantityAvailable))
          throw Error('Quantity must be a whole number');
        if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(d.price))
          throw Error('Price must have at most two decimal places');
        if (file && imageUrl) throw Error('Choose a file or an image URL');
        if (removeImage && (file || imageUrl))
          throw Error('Remove the image or choose a replacement');
        if (imageUrl && !/^https:\/\/[^\s]+$/.test(imageUrl))
          throw Error('Image URL must start with https://');
        if (removeImage) d.images = [];
        else if (file) {
          const url = await uploadPhoto(file);
          d.images = [url];
          $('product-image-file').value = '';
          $('product-image-url').value = url;
          previewImage(url);
        } else if (imageUrl) {
          const existing = state.myProducts.find((p) => p._id === id);
          if (!existing || imageUrl !== existing.images?.[0])
            d.images = [imageUrl];
        }
        await call(
          id ? '/products/' + id : '/products',
          id ? 'PATCH' : 'POST',
          d,
        );
        notify(
          id
            ? form.dataset.resubmit
              ? 'Product updated and resubmitted for approval'
              : 'Product updated'
            : 'Product created and submitted for admin approval',
        );
        resetProduct();
        await refreshMyProducts();
        page('dashboard');
      } finally {
        $('save-product').disabled = false;
      }
    });
  };
  function visibleMyProducts() {
    const search = $('product-search').value.trim().toLowerCase();
    const category = $('product-category').value;
    const sort = $('product-sort').value;
    const showListed = $('filter-listed').checked;
    const showRejected = $('filter-rejected').checked;
    const showDeleted = $('filter-deleted').checked;
    const anyStateChecked = showListed || showRejected || showDeleted;
    const matchesCheckedState = (p) =>
      (showListed && p.listProduct) ||
      (showRejected && p.approvalStatus === 'rejected') ||
      (showDeleted && p.active === false);
    const items = state.myProducts.filter(
      (p) =>
        (!search || p.title.toLowerCase().includes(search)) &&
        (!category || p.category === category) &&
        (!anyStateChecked || matchesCheckedState(p)),
    );
    const byId = (a, b) => (a._id < b._id ? 1 : -1);
    const comparators = {
      newest: byId,
      title: (a, b) => a.title.localeCompare(b.title),
      priceHigh: (a, b) => b.price - a.price,
      priceLow: (a, b) => a.price - b.price,
      stockHigh: (a, b) =>
        (b.inventory?.quantityAvailable || 0) -
        (a.inventory?.quantityAvailable || 0),
    };
    return items.sort(comparators[sort] || byId);
  }
  function renderMyProducts() {
    const all = state.myProducts;
    const items = visibleMyProducts();
    $('product-count').textContent = all.length
      ? `Showing ${items.length} of ${all.length} products`
      : '';
    $('artist-products').innerHTML = items.length
      ? items
          .map((p) => {
            const deleted = p.active === false;
            const cardState = deleted
              ? 'is-deleted'
              : p.approvalStatus === 'rejected'
                ? 'is-rejected'
                : '';
            const statusTags = deleted
              ? '<span class="tag">Deleted</span>'
              : `<span class="tag">${esc(p.approvalStatus)}</span> <span class="tag">${p.listProduct ? 'Listed' : 'Not listed'}</span>`;
            const stock = deleted
              ? '<span class="hint">Removed from store</span>'
              : `<span class="hint">${esc(p.inventory?.quantityAvailable)} available</span>`;
            return `<article class="product-card ${cardState}"><div class="product-img">${productImage(p)}</div><h3><a href="#product-detail-view" class="product-title" data-artist-details="${esc(p._id)}">${esc(p.title)}</a></h3><div class="category">${esc(p.category)}</div><div class="product-rating">Rating: ${ratingSummary(p)}</div><div class="product-status">${statusTags}</div><div class="card-bottom"><span class="price">${money(p.price)}</span>${stock}</div>${deleted ? '' : `<div class="actions"><button class="outline" data-edit-product="${esc(p._id)}">Edit</button><button class="danger-btn" data-delete-product="${esc(p._id)}">Delete</button></div>`}</article>`;
          })
          .join('')
      : `<p class="muted">${all.length ? 'No products match these filters.' : 'No products created yet.'}</p>`;
  }
  async function refreshMyProducts() {
    const data = await call('/products/mine');
    state.myProducts = data.products;
    const categorySelect = $('product-category');
    const previous = categorySelect.value;
    const categories = [...new Set(data.products.map((p) => p.category))]
      .filter(Boolean)
      .sort();
    categorySelect.innerHTML = [
      '<option value="">All categories</option>',
      ...categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`),
    ].join('');
    categorySelect.value = categories.includes(previous) ? previous : '';
    renderMyProducts();
  }
  for (const id of [
    'product-search',
    'product-category',
    'product-sort',
    'filter-listed',
    'filter-rejected',
    'filter-deleted',
  ])
    $(id).addEventListener(
      id === 'product-search' ? 'input' : 'change',
      renderMyProducts,
    );
  $('artist-refresh').onclick = () => run(refreshMyProducts);
  $('artist-add-product').addEventListener('click', resetProduct);
  $('clear-product-filters').onclick = () => {
    $('product-search').value = '';
    $('product-category').value = '';
    $('product-sort').value = 'newest';
    $('filter-listed').checked = false;
    $('filter-rejected').checked = false;
    $('filter-deleted').checked = false;
    renderMyProducts();
  };
  const handleArtistProductClick = (e) => {
    const titleLink = e.target.closest('[data-artist-details]'),
      edit = e.target.closest('[data-edit-product]'),
      del = e.target.closest('[data-delete-product]');
    if (titleLink) {
      e.preventDefault();
      const p = state.myProducts.find(
        (x) => x._id === titleLink.dataset.artistDetails,
      );
      if (!p) return;
      page('catalog');
      showProductDetails(p, 'artist');
      return;
    }
    if (edit) {
      const p = state.myProducts.find(
        (x) => x._id === edit.dataset.editProduct,
      );
      if (!p) return;
      resetProduct();
      const f = $('product-form');
      for (const field of ['title', 'description', 'price', 'category'])
        f.elements.namedItem(field).value = p[field] || '';
      f.elements.namedItem('quantityAvailable').value =
        p.inventory.quantityAvailable;
      f.elements.namedItem('materials').value = p.materials.join(', ');
      f.elements.namedItem('tags').value = (p.tags || []).join(', ');
      const sustainability = p.sustainability || {};
      $('sustainability-practices').innerHTML = practiceCheckboxes(
        sustainability.practices || [],
      );
      $('sustainability-summary').value = sustainability.summary || '';
      $('certification-list').innerHTML = '';
      for (const c of sustainability.certifications || [])
        addCertificationRow(c);
      f.elements.namedItem('editingId').value = p._id;
      const resubmit = p.approvalStatus === 'rejected';
      f.dataset.resubmit = resubmit ? 'yes' : '';
      setSustainabilityLocked(Boolean(p.listProduct && p.approvalStatus === 'approved'));
      $('product-image-url').value = p.images?.[0] || '';
      previewImage($('product-image-url').value);
      $('product-form-title').textContent = 'Edit product';
      $('save-product').textContent = resubmit ? 'Save and resubmit' : 'Save changes';
      page('artist-add-product');
      f.scrollIntoView({ behavior: 'smooth' });
    }
    if (del)
      run(async () => {
        if (
          !confirm(
            'Delete this product? It will be marked deleted and hidden from the store. Its data is kept in the database.',
          )
        )
          return;
        await call('/products/' + del.dataset.deleteProduct, 'DELETE');
        notify('Product deleted');
        await refreshMyProducts();
        page('dashboard');
      });
  };
  $('artist-products').onclick = handleArtistProductClick;
  $('product-detail-content').addEventListener(
    'click',
    handleArtistProductClick,
  );
  // Customer cart actions use product IDs; server checks ownership, eligibility and available inventory.
  function renderCart() {
    const div = $('cart-items');
    const unavailable = (x) =>
      !x.product ||
      x.product.quantityAvailable === 0 ||
      x.quantity > x.product.quantityAvailable;
    div.innerHTML = state.cart.items.length
      ? state.cart.items
          .map((x) => {
            const p = x.product;
            const pid = esc(x.productId);
            if (!p)
              return `<article class="cart-line is-unavailable"><div class="cart-info"><h3>Product ${esc(x.productId.slice(-8))}</h3><p class="error-text">This product is no longer available. Remove it to continue.</p><div class="actions"><button class="danger-btn" data-remove-cart="${pid}">Remove</button></div></div></article>`;
            const available = Number(p.quantityAvailable) || 0;
            const outOfStock = available <= 0;
            const short = !outOfStock && x.quantity > available;
            const atMax = x.quantity >= Math.min(100, available);
            const message = outOfStock
              ? 'Out of stock. Remove this item to continue checkout.'
              : short
                ? `Only ${esc(available)} left in stock. Reduce the quantity to continue checkout.`
                : '';
            return `<article class="cart-line${outOfStock || short ? ' is-unavailable' : ''}"><div class="cart-img">${productImage(p)}</div><div class="cart-info"><h3>${esc(p.title)}</h3><div class="category">${esc(p.category)}</div><div class="price">${money(p.price)}</div>${message ? `<p class="error-text">${message}</p>` : ''}<div class="actions"><button class="secondary" aria-label="Decrease quantity" data-cart-step="-1" data-cart-product="${pid}" ${outOfStock || x.quantity <= 1 ? 'disabled' : ''}>−</button><span class="cart-qty" aria-live="polite">${esc(x.quantity)}</span><button class="secondary" aria-label="Increase quantity" data-cart-step="1" data-cart-product="${pid}" ${outOfStock || atMax ? 'disabled' : ''}>+</button><button class="danger-btn" data-remove-cart="${pid}">Remove</button></div></div></article>`;
          })
          .join('')
      : '<p class="muted">Your cart is empty. Discover a product to get started.</p>';
    state.cartReady =
      state.cart.items.length > 0 && !state.cart.items.some(unavailable);
    updatePlaceOrder();
    updateCartControls();
    updateCartBadge();
  }
  function updateCartBadge() {
    const count = (state.cart?.items || []).reduce(
      (sum, item) => sum + (Number(item.quantity) || 0),
      0,
    );
    const badge = $('cart-count');
    badge.hidden = !count;
    badge.textContent = count > 99 ? '99+' : count;
  }
  async function refreshCart() {
    const token = state.token,
      version = cartVersion;
    const data = await call('/cart');
    if (state.token !== token || version !== cartVersion) return;
    state.cart = data.cart;
    renderCart();
    updateCartControls();
  }
  async function withCartWrite(fn) {
    if (cartBusy) {
      notify('Please wait for the cart update to finish.', false);
      return;
    }
    cartBusy = true;
    cartVersion++;
    updateCartControls();
    try {
      await fn();
    } finally {
      cartVersion++;
      cartBusy = false;
      updateCartControls();
    }
  }
  async function changeCatalogCart(productId, delta) {
    if (state.user?.role !== 'customer') {
      notify('Sign in as a customer to add to your cart', false);
      page('auth');
      return;
    }
    await withCartWrite(async () => {
      const token = state.token;
      if (!state.cart) await refreshCart();
      if (state.token !== token) return;
      const quantity =
        state.cart.items.find((item) => item.productId === productId)
          ?.quantity || 0;
      if (delta < 0 && !quantity)
        throw Error(
          'This product is no longer in your cart. Refresh the cart and try again.',
        );
      const path = quantity
        ? '/cart/items/' + encodeURIComponent(productId)
        : '/cart/items';
      const method = quantity
        ? quantity === 1 && delta < 0
          ? 'DELETE'
          : 'PATCH'
        : 'POST';
      const body =
        method === 'POST'
          ? { productId, quantity: 1 }
          : method === 'PATCH'
            ? { quantity: quantity + delta }
            : undefined;
      const response = await call(path, method, body);
      if (state.token === token) {
        state.cart = response.cart;
        renderCart();
      }
    });
  }
  $('cart-refresh').onclick = () => run(refreshCart);
  $('cart-items').onclick = (e) => {
    const step = e.target.closest('[data-cart-step]'),
      del = e.target.closest('[data-remove-cart]');
    if (step)
      run(() =>
        withCartWrite(async () => {
          const token = state.token,
            productId = step.dataset.cartProduct,
            current =
              state.cart.items.find((item) => item.productId === productId)
                ?.quantity || 0;
          if (!current)
            throw Error(
              'This product is no longer in your cart. Refresh the cart and try again.',
            );
          const data = await call(
            '/cart/items/' + encodeURIComponent(productId),
            'PATCH',
            { quantity: current + Number(step.dataset.cartStep) },
          );
          if (state.token === token) {
            state.cart = data.cart;
            renderCart();
          }
        }),
      );
    if (del)
      run(() =>
        withCartWrite(async () => {
          const token = state.token,
            data = await call(
              '/cart/items/' + del.dataset.removeCart,
              'DELETE',
            );
          if (state.token === token) {
            state.cart = data.cart;
            renderCart();
            notify('Removed from cart');
          }
        }),
      );
  };
  // The customer has one shipping address, stored in the existing personalInfo.address field.
  const addressFieldNames = ['street', 'city', 'state', 'zipCode', 'country'];
  function savedAddress() {
    const a = state.user?.personalInfo?.address;
    return a && addressFieldNames.every((f) => a[f]) ? a : null;
  }
  function addressSummary(a) {
    return `${a.street}, ${a.city}, ${a.state} ${a.zipCode}, ${a.country}`;
  }
  function fillAddressForm(form) {
    const a = savedAddress() || {};
    addressFieldNames.forEach((f) => {
      form.elements[f].value = a[f] || (f === 'country' ? 'United States' : '');
    });
  }
  // Account edit: only fields the API accepts for the role are editable (see ACCOUNT_EDITABLE).
  // Admin details are read-only in the UI, so admins get no edit button.
  const ACCOUNT_EDITABLE = {
    artist: ['firstName', 'lastName', 'mobile', 'originStory'],
    customer: ['firstName', 'lastName', 'mobile', 'address'],
  };
  function accountRows(u) {
    const info = u.personalInfo || {};
    const rows = [['First name', info.firstName], ['Last name', info.lastName]];
    if (u.role !== 'admin') rows.push(['Mobile', info.mobile]);
    rows.push(['Email', u.email]);
    if (u.role === 'customer') {
      const address = savedAddress();
      rows.push(['Role', u.role]);
      rows.push(['Address', address ? addressSummary(address) : '']);
    }
    if (u.role === 'artist') rows.push(['Origin story', u.artistProfile?.originStory]);
    return rows;
  }
  function renderAccount() {
    const role = state.user?.role;
    $('account-details').innerHTML = accountRows(state.user)
      .map(
        ([label, value]) =>
          `<div><dt>${esc(label)}</dt><dd>${value ? esc(value) : '<span class="muted">Not added</span>'}</dd></div>`,
      )
      .join('');
    $('account-edit-form')
      .querySelectorAll('[data-roles]')
      .forEach((el) => {
        el.hidden = !el.dataset.roles.split(' ').includes(role);
      });
    $('account-edit').hidden = !ACCOUNT_EDITABLE[role];
    renderCheckoutAddress();
  }
  function setAccountEditing(open) {
    if (open) {
      const form = $('account-edit-form');
      const info = state.user.personalInfo || {};
      form.elements.namedItem('firstName').value = info.firstName || '';
      form.elements.namedItem('lastName').value = info.lastName || '';
      form.elements.namedItem('mobile').value = info.mobile || '';
      form.elements.namedItem('originStory').value =
        state.user.artistProfile?.originStory || '';
      fillAddressForm(form);
    }
    $('account-edit-form').hidden = !open;
    $('account-card').classList.toggle('is-editing', open);
    $('account-card').setAttribute('aria-disabled', String(open));
    $('account-edit').disabled = open;
  }
  function openAccountEdit() {
    setAccountEditing(true);
    $('account-edit-form').scrollIntoView({ block: 'nearest' });
  }
  $('account-edit').onclick = openAccountEdit;
  $('account-cancel').onclick = () => setAccountEditing(false);
  $('account-edit-form').onsubmit = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    run(async () => {
      const role = state.user.role;
      const data = formData(form);
      const payload = {};
      for (const field of ACCOUNT_EDITABLE[role] || [])
        if (field !== 'address') payload[field] = data[field] ?? '';
      if (role === 'artist' && !payload.originStory.trim())
        throw Error('Origin story cannot be empty.');
      const token = state.token;
      let r = await call('/auth/me', 'PATCH', payload);
      if (state.token !== token) return;
      state.user = r.user;
      if (role === 'customer') {
        const address = Object.fromEntries(
          addressFieldNames.map((f) => [f, (data[f] || '').trim()]),
        );
        if (addressFieldNames.some((f) => address[f])) {
          r = await call('/auth/me/address', 'PUT', address);
          if (state.token !== token) return;
          state.user = r.user;
        }
      }
      setAccountEditing(false);
      notify('Account updated');
      renderAccount();
    });
  };

  function renderCheckoutAddress() {
    const address = savedAddress();
    $('address-summary').innerHTML = address
      ? `<p>${esc(addressSummary(address))}</p>`
      : '<p class="muted">No shipping address yet. Add one on your account page.</p>';
    $('edit-checkout-address').textContent = address ? 'Edit' : 'Add address';
    if (!address) $('confirm-address').checked = false;
    $('confirm-address').disabled = !address;
    updatePlaceOrder();
  }
  function updatePlaceOrder() {
    $('place-order').disabled =
      !state.cartReady || !savedAddress() || !$('confirm-address').checked;
  }
  function setCheckoutOpen(open) {
    $('checkout-panel').hidden = !open;
    $('checkout-toggle').setAttribute('aria-expanded', String(open));
    $('checkout-toggle').textContent = open ? 'Hide checkout' : 'Checkout';
  }
  $('checkout-toggle').onclick = () =>
    setCheckoutOpen($('checkout-panel').hidden);
  $('confirm-address').onchange = updatePlaceOrder;
  // Address editing lives on the account page; checkout only confirms the saved address.
  $('edit-checkout-address').onclick = () => {
    $('confirm-address').checked = false;
    page('dashboard');
    openAccountEdit();
  };
  // Checkout is simulated; the backend transaction owns inventory, order totals and cart clearing.
  $('place-order').onclick = () => {
    run(async () => {
      const address = savedAddress();
      if (!address) throw Error('Add a shipping address first.');
      if (!state.cart?.items.length) throw Error('Your cart is empty.');
      if (!confirm('Place a simulated order? No payment will be processed.'))
        return;
      await withCartWrite(async () => {
        const token = state.token,
          data = await call('/orders/checkout', 'POST', {
            shippingAddress: Object.fromEntries(
              addressFieldNames.map((f) => [f, address[f]]),
            ),
          });
        if (state.token !== token) return;
        setCheckoutOpen(false);
        $('confirm-address').checked = false;
        renderCheckoutAddress();
        notify('Order placed: ' + data.order._id + ' (no payment processed)');
        await Promise.all([refreshCart(), refreshOrders(), refreshHome()]);
      });
    });
  };
  function itemStateKey(item) {
    if (item.status !== 'active') return 'cancelled';
    return item.shipping.status === 'shipped' ? 'shipped' : 'pending';
  }
  const orderStates = [
    {
      key: 'all',
      label: 'All',
      empty: 'No orders yet.',
      match: () => true,
    },
    {
      key: 'pending',
      label: 'Pending',
      empty: 'No pending items.',
      match: (v) => itemStateKey(v.item) === 'pending',
    },
    {
      key: 'shipped',
      label: 'Shipped',
      empty: 'No shipped items yet.',
      match: (v) => itemStateKey(v.item) === 'shipped',
    },
    {
      key: 'cancelled',
      label: 'Cancelled',
      empty: 'No cancelled items.',
      match: (v) => itemStateKey(v.item) === 'cancelled',
    },
  ];
  let orderState = 'all',
    orderRows = [];
  function orderRowsFor(key) {
    const info = orderStates.find((s) => s.key === key);
    return orderRows.filter((row) => info.match(row));
  }
  function renderOrderStates() {
    $('order-states').innerHTML = orderStates
      .map(
        (s) =>
          `<button class="outline approval-state" type="button" data-order-state="${esc(s.key)}" aria-pressed="${s.key === orderState}">${esc(s.label)} (${orderRowsFor(s.key).length})</button>`,
      )
      .join('');
  }
  function formatStamp(value) {
    return new Date(value).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  }
  function renderOrders() {
    renderOrderStates();
    const info = orderStates.find((s) => s.key === orderState);
    const rows = orderRowsFor(orderState);
    const groups = new Map();
    rows.forEach((row) => {
      if (!groups.has(row.orderId))
        groups.set(row.orderId, { placed: row.placed, rows: [] });
      groups.get(row.orderId).rows.push(row);
    });
    $('customer-orders').innerHTML = groups.size
      ? [...groups]
          .map(([groupId, group]) => {
            const cards = group.rows
              .map(({ orderId, item, index }) => {
                const product = [
                  ...(state.products || []),
                  ...(state.homeProducts || []),
                ].find((p) => p._id === item.productId);
                const image = product?.images?.[0]
                  ? `<img src="${esc(product.images[0])}" alt="${esc(item.productSnapshot.title)}" loading="lazy">`
                  : productPlaceholder;
                const amount = Number(item.unitPrice) * item.quantity;
                const st = orderStates.find(
                  (s) => s.key === itemStateKey(item),
                );
                const tracking = item.shipping.trackingNumber
                  ? `<li>Tracking ID: ${esc(item.shipping.trackingNumber)}</li>`
                  : '';
                const cancel =
                  item.status === 'active' && item.shipping.status === 'pending'
                    ? `<button class="danger-btn order-action" data-cancel-order="${esc(orderId)}" data-item-index="${esc(index)}">Cancel item</button>`
                    : item.status === 'active' && item.shipping.status === 'shipped' && !item.review
                      ? `<button class="secondary order-action" data-review-toggle>Write review</button>`
                      : '';
                const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
                const review =
                  item.status === 'active' && item.shipping.status === 'shipped' && item.review
                    ? `<div class="review-saved"><span class="rating-stars" aria-label="${esc(item.review.rating)} of 5 stars">${stars(item.review.rating)}</span><p>${esc(item.review.comment || 'No comment')}</p><button class="danger-btn order-action" data-order-review-delete="${esc(item.review._id)}">Delete review</button></div>`
                    : item.status === 'active' && item.shipping.status === 'shipped'
                      ? `<form class="review-form" data-review-product="${esc(item.productId)}" data-review-order="${esc(orderId)}" hidden><div class="star-picker" role="group" aria-label="Rating">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star-btn" data-star="${n}" aria-label="${n} star${n > 1 ? 's' : ''}" aria-pressed="false">☆</button>`).join('')}</div><label>Comment (optional)<input type="text" name="comment" maxlength="100"></label><div class="actions"><button class="primary" type="submit">Submit review</button><button class="secondary" type="button" data-review-cancel>Cancel</button></div></form>`
                      : '';
                return `<article class="order-card sales-card order-customer-card"><div class="sales-img">${image}</div><div class="sales-body"><div class="spaced"><strong>${esc(item.productSnapshot.title)}</strong><span class="tag">${esc(st.label)}</span></div><div class="order-row"><ul class="sales-facts"><li>Artist: ${esc(item.productSnapshot.artistName)}</li><li>Quantity ordered: ${esc(item.quantity)}</li><li>Amount paid: ${money(amount)}</li>${tracking}</ul><div class="actions">${cancel}</div></div>${review}</div></article>`;
              })
              .join('');
            const placed = group.placed
              ? `<span>Placed ${esc(formatStamp(group.placed))}</span>`
              : '';
            return `<section class="order-group"><header class="order-group-head"><strong>Order ID: ${esc(groupId)}</strong>${placed}</header>${cards}</section>`;
          })
          .join('')
      : `<p class="empty">${esc(info.empty)}</p>`;
  }
  async function refreshOrders() {
    const r = await call('/orders/mine');
    state.orders = r.orders;
    orderRows = r.orders.flatMap((o) =>
      o.items.map((item, i) => ({
        orderId: o._id,
        placed: o.createdAt,
        item,
        index: i,
      })),
    );
    renderOrders();
  }
  $('orders-refresh').onclick = () => run(refreshOrders);
  $('order-states').onclick = (e) => {
    const b = e.target.closest('[data-order-state]');
    if (b) {
      orderState = b.dataset.orderState;
      renderOrders();
    }
  };
  $('customer-orders').onclick = (e) => {
    const cancel = e.target.closest('[data-cancel-order]'),
      toggle = e.target.closest('[data-review-toggle]'),
      star = e.target.closest('[data-star]'),
      reviewCancel = e.target.closest('[data-review-cancel]'),
      reviewDelete = e.target.closest('[data-order-review-delete]');
    if (reviewDelete)
      run(async () => {
        if (!confirm('Delete this review? You can write a new one afterwards.'))
          return;
        await call('/reviews/' + reviewDelete.dataset.orderReviewDelete, 'DELETE');
        notify('Review removed');
        await refreshOrders();
      });
    if (cancel)
      run(async () => {
        if (!confirm('Cancel this unshipped item and return the stock?'))
          return;
        await call(
          `/orders/${cancel.dataset.cancelOrder}/items/${cancel.dataset.itemIndex}/cancel`,
          'PATCH',
          {},
        );
        notify('Item cancelled and inventory restored');
        await refreshOrders();
      });
    if (toggle) {
      const form = toggle.closest('.order-card').querySelector('.review-form');
      form.hidden = !form.hidden;
    }
    if (reviewCancel) reviewCancel.closest('.review-form').hidden = true;
    if (star) {
      const form = star.closest('.review-form'),
        value = Number(star.dataset.star);
      form.dataset.rating = String(value);
      form.querySelectorAll('[data-star]').forEach((b) => {
        const on = Number(b.dataset.star) <= value;
        b.textContent = on ? '★' : '☆';
        b.setAttribute('aria-pressed', String(on));
      });
    }
  };
  $('customer-orders').onsubmit = (e) => {
    const form = e.target.closest('.review-form');
    if (!form) return;
    e.preventDefault();
    run(async () => {
      if (!form.dataset.rating) {
        notify('Choose a star rating first');
        return;
      }
      await call('/reviews', 'POST', {
        productId: form.dataset.reviewProduct,
        orderId: form.dataset.reviewOrder,
        rating: Number(form.dataset.rating),
        comment: form.elements.comment.value,
      });
      notify('Verified-purchase review created');
      await refreshOrders();
    });
  };

  // Artist fulfillment uses original itemIndex values, even after filtering multi-artist orders.
  // Shipping states come from each item's status and shipping.status; cancelled items get their own state.
  const salesStates = [
    {
      key: 'all',
      label: 'All',
      empty: 'No orders yet.',
      match: () => true,
    },
    {
      key: 'to_ship',
      label: 'To ship',
      empty: 'No items waiting to ship.',
      match: (v) => v.status === 'active' && v.shipping.status === 'pending',
    },
    {
      key: 'shipped',
      label: 'Shipped',
      empty: 'No shipped items.',
      match: (v) =>
        v.status === 'active' && v.shipping.status === 'shipped',
    },
    {
      key: 'cancelled',
      label: 'Cancelled',
      empty: 'No cancelled items.',
      match: (v) => v.status !== 'active',
    },
  ];
  let salesState = 'all',
    salesRows = [];
  function salesRowsFor(key) {
    const info = salesStates.find((s) => s.key === key);
    return salesRows.filter((row) => info.match(row.item));
  }
  function renderSalesStates() {
    $('sales-states').innerHTML = salesStates
      .map(
        (s) =>
          `<button class="outline approval-state" type="button" data-sales-state="${esc(s.key)}" aria-pressed="${s.key === salesState}">${esc(s.label)} (${salesRowsFor(s.key).length})</button>`,
      )
      .join('');
  }
  function renderSales() {
    renderSalesStates();
    const info = salesStates.find((s) => s.key === salesState);
    const rows = salesRowsFor(salesState);
    const groups = new Map();
    rows.forEach((row) => {
      if (!groups.has(row.orderId))
        groups.set(row.orderId, { placed: row.placed, rows: [] });
      groups.get(row.orderId).rows.push(row);
    });
    $('artist-sales').innerHTML = groups.size
      ? [...groups]
          .map(([groupId, group]) => {
            const cards = group.rows
              .map(({ item, index }) => {
                const product = (state.myProducts || []).find(
                  (p) => p._id === item.productId,
                );
                const image = product?.images?.[0]
                  ? `<img src="${esc(product.images[0])}" alt="${esc(item.productSnapshot.title)}" loading="lazy">`
                  : productPlaceholder;
                const itemKey =
                  item.status !== 'active'
                    ? 'cancelled'
                    : item.shipping.status === 'shipped'
                      ? 'shipped'
                      : 'to_ship';
                const st = salesStates.find((s) => s.key === itemKey);
                const tracking = item.shipping.trackingNumber
                  ? `<li>Tracking ID: ${esc(item.shipping.trackingNumber)}</li>`
                  : '';
                const shipRow =
                  item.status === 'active' && item.shipping.status === 'pending'
                    ? `<div class="order-row ship-row"><label class="ship-label">Tracking ID<input type="text" maxlength="100" data-tracking-input placeholder="e.g. 1Z999AA10123456784" required></label><div class="actions"><button class="secondary order-action" data-ship-id="${esc(groupId)}" data-ship-item="${esc(index)}" data-ship-status="shipped">Mark shipped</button></div></div>`
                    : '';
                return `<article class="order-card sales-card order-customer-card"><div class="sales-img">${image}</div><div class="sales-body"><div class="spaced"><strong>${esc(item.productSnapshot.title)}</strong><span class="tag">${esc(st.label)}</span></div><div class="order-row"><ul class="sales-facts"><li>Quantity: ${esc(item.quantity)}</li><li>Artist payout (after commission): ${money(item.artistPayout)}</li>${tracking}</ul></div>${shipRow}</div></article>`;
              })
              .join('');
            const placed = group.placed
              ? `<span>Placed ${esc(formatStamp(group.placed))}</span>`
              : '';
            return `<section class="order-group"><header class="order-group-head"><strong>Order ID: ${esc(groupId)}</strong>${placed}</header>${cards}</section>`;
          })
          .join('')
      : `<p class="empty">${esc(info.empty)}</p>`;
  }
  async function refreshSales() {
    const [r] = await Promise.all([call('/orders/sales'), refreshMyProducts()]);
    state.sales = r.sales;
    salesRows = r.sales.flatMap((o) =>
      o.items.map((item, i) => ({
        orderId: o.orderId,
        placed: o.createdAt,
        item,
        index: item.itemIndex ?? i,
      })),
    );
    renderSales();
  }
  $('sales-refresh').onclick = () => run(refreshSales);
  $('sales-states').onclick = (e) => {
    const b = e.target.closest('[data-sales-state]');
    if (b) {
      salesState = b.dataset.salesState;
      renderSales();
    }
  };
  $('artist-sales').onclick = (e) => {
    const b = e.target.closest('[data-ship-id]');
    if (b)
      run(async () => {
        const next = b.dataset.shipStatus;
        const body = { status: next };
        if (next === 'shipped') {
          const tracking = b
            .closest('.order-card')
            .querySelector('[data-tracking-input]')
            .value.trim();
          if (!tracking) throw Error('Enter a tracking ID before marking shipped.');
          body.trackingNumber = tracking;
        }
        await call(
          `/orders/${b.dataset.shipId}/items/${b.dataset.shipItem}/ship`,
          'PATCH',
          body,
        );
        notify('Shipping updated');
        await refreshSales();
      });
  };
  // Approval states mirror stored onboarding status values; each action is one allowed admin transition.
  const approvalStates = [
    {
      key: 'request_received',
      label: 'New artist requests',
      actions: [['waiting_for_documents', 'Request documents']],
    },
    {
      key: 'waiting_for_documents',
      label: 'Waiting for documents',
      actions: [['received_documents', 'Documents received']],
    },
    {
      key: 'received_documents',
      label: 'Under review',
      actions: [
        ['waiting_for_documents', 'Request additional info'],
        ['approved', 'Approve'],
        ['rejected', 'Reject'],
      ],
    },
    { key: 'approved', label: 'Approved', actions: [] },
    { key: 'rejected', label: 'Rejected', actions: [] },
  ];
  let approvalState = 'request_received';
  const approvalLabel = (key) =>
    approvalStates.find((s) => s.key === key)?.label || 'Unknown status';
  function renderApprovalStates() {
    $('approval-states').innerHTML = approvalStates
      .map(
        (s) =>
          `<button class="outline approval-state" type="button" data-approval-state="${esc(s.key)}" aria-pressed="${s.key === approvalState}">${esc(s.label)}</button>`,
      )
      .join('');
  }
  // Ignore stale responses so quickly switching states never shows another state's artists.
  async function refreshArtists() {
    renderApprovalStates();
    const current = approvalState,
      info = approvalStates.find((s) => s.key === current);
    const r = await call(
      '/admin/artists?status=' + encodeURIComponent(current),
    );
    if (current !== approvalState) return;
    $('admin-artists').innerHTML = r.artists.length
      ? r.artists
          .map(
            (u) =>
              `<article class="order-card"><div class="spaced"><strong>${esc(u.personalInfo.firstName)} ${esc(u.personalInfo.lastName)}</strong><span class="tag">${esc(approvalLabel(u.artistProfile?.onboardingStatus))}</span></div><p class="muted">${esc(u.email)} · ${esc(u.artistProfile?.originStory || '')}</p><div class="actions">${info.actions.map(([status, label]) => `<button class="secondary" type="button" data-approve-artist="${esc(u.id)}" data-status="${esc(status)}">${esc(label)}</button>`).join('')}</div></article>`,
          )
          .join('')
      : `<p class="empty">No artists in ${esc(info.label.toLowerCase())}.</p>`;
  }
  $('approvals-refresh').onclick = () =>
    run(async () => {
      const current = approvalState;
      await refreshArtists();
      if (current === approvalState)
        notify(
          'Refreshed ' + approvalLabel(current).toLowerCase() + ' artists',
        );
    });
  $('approval-states').onclick = (e) => {
    const b = e.target.closest('[data-approval-state]');
    if (b) {
      approvalState = b.dataset.approvalState;
      run(refreshArtists);
    }
  };
  $('admin-artists').onclick = (e) => {
    const b = e.target.closest('[data-approve-artist]');
    if (b)
      run(async () => {
        await call(
          '/admin/artists/' + b.dataset.approveArtist + '/approval',
          'PATCH',
          { status: b.dataset.status },
        );
        notify('Artist moved to: ' + approvalLabel(b.dataset.status));
        await refreshArtists();
      });
  };
  // Curate state: products and artist pages are fetched from the server; checked artists filter products server-side.
  let curatePage = 1;
  let curateTotalPages = 1;
  let curateProducts = [];
  const artistFilter = new Set();
  let artistSearch = '';
  let artistSearchTimer;
  let artistPage = 0;
  let artistTotal = 0;
  let curateArtists = [];
  // Checked artists sort to the top of the loaded list; the stable sort keeps the rest alphabetical.
  function renderArtistFilter() {
    const items = curateArtists
      .slice()
      .sort((a, b) => artistFilter.has(b.id) - artistFilter.has(a.id))
      .map((u) => {
        const checked = artistFilter.has(u.id);
        return `<label class="artist-filter-item${checked ? ' checked' : ''}"><input type="checkbox" value="${esc(u.id)}"${checked ? ' checked' : ''}><span>${esc(u.personalInfo.firstName)} ${esc(u.personalInfo.lastName)}</span></label>`;
      })
      .join('');
    const more =
      curateArtists.length < artistTotal
        ? `<button class="outline" type="button" data-show-more>Show more</button>`
        : '';
    $('artist-filter-list').innerHTML = curateArtists.length
      ? items + more
      : '<p class="empty">No approved artists match.</p>';
  }
  // Ignore responses for a search that has since changed.
  async function loadArtists(reset) {
    const query = artistSearch.trim();
    const page = reset ? 1 : artistPage + 1;
    const r = await call(
      `/admin/artists?status=approved&sort=name&pageSize=10&page=${page}&q=${encodeURIComponent(query)}`,
    );
    if (query !== artistSearch.trim()) return;
    curateArtists = reset ? r.artists : curateArtists.concat(r.artists);
    artistPage = page;
    artistTotal = r.total;
    renderArtistFilter();
  }
  // Sustainability review: View shows entered details on hover, Edit opens a checklist beside the card.
  const susEntered = (s) =>
    (s.practices || []).length || s.summary || (s.certifications || []).length;
  function susView(id, s) {
    const practices = (s.practices || []).map((code) => SUSTAINABILITY_PRACTICES[code] || code);
    const certs = (s.certifications || []).map(
      (c) => `${c.name} · ${c.issuer}${c.verified ? ' (verified)' : ''}`,
    );
    const tip =
      (practices.length ? `<p><strong>Practices:</strong> ${esc(practices.join(', '))}</p>` : '') +
      (s.summary ? `<p><strong>Summary:</strong> ${esc(s.summary)}</p>` : '') +
      (certs.length ? `<p><strong>Certifications:</strong> ${esc(certs.join('; '))}</p>` : '');
    return `<div class="sus-field"><span class="hint">Sustainability</span><div class="sus-actions"><div class="sus-view"><button class="outline" type="button" aria-describedby="sus-tip-${id}">View</button><div class="sus-tip" role="tooltip" id="sus-tip-${id}">${tip}</div></div><button class="outline" type="button" data-sus-edit="${id}">Edit</button></div>${susPanel(id, s)}</div>`;
  }
  // Checklist of entered items; unchecking removes that practice or certification on save.
  function susPanel(id, s) {
    const practices = (s.practices || [])
      .map((code) => `<label class="practice-option"><input type="checkbox" data-sus-keep="practice:${esc(code)}" checked> ${esc(SUSTAINABILITY_PRACTICES[code] || code)}</label>`)
      .join('');
    const certs = (s.certifications || [])
      .map(
        (c, i) => `<div class="sus-cert"><label class="practice-option"><input type="checkbox" data-sus-keep="cert:${i}" checked> ${esc(c.name)} · ${esc(c.issuer)}</label><label class="practice-option"><input type="checkbox" data-cert-verified="${i}"${c.verified ? ' checked' : ''}> Verified by EcoCraft</label></div>`,
      )
      .join('');
    return `<div class="sus-panel" data-sus-panel="${id}" data-side="right" hidden><p class="sus-panel-title">Edit sustainability</p>${practices ? `<p class="hint">Practices</p>${practices}` : ''}${certs ? `<p class="hint">Certifications</p>${certs}` : ''}<div class="curate-actions"><button class="primary" type="button" data-save-kept="${id}">Save</button><button class="secondary" type="button" data-sus-cancel="${id}">Cancel</button></div></div>`;
  }
  // Admins verify artist-declared certifications in the sustainability panel.
  function curateCard(p) {
    const sustainability = p.sustainability || {};
    const susField = susEntered(sustainability) ? susView(esc(p._id), sustainability) : '';
    const review = `${susField}<label class="hint">Commission (%) <input class="small-input" type="number" min="0" max="100" step="0.01" placeholder="Enter %" data-commission="${esc(p._id)}"></label><div class="curate-actions"><button class="secondary" data-review-id="${esc(p._id)}" data-review-status="approved">Approve and list</button><button class="danger-btn" data-review-id="${esc(p._id)}" data-review-status="rejected">Reject</button></div>`;
    return `<article class="product-card curate-card" data-curate-card="${esc(p._id)}"><div class="product-img">${productImage(p)}</div><h3><a href="#product-detail-view" class="product-title" data-curate-details="${esc(p._id)}">${esc(p.title)}</a></h3><div class="category">${esc(p.category)}</div><p class="hint">Artist: ${esc(p.artistName)}</p><div class="card-bottom"><span class="price">${money(p.price)}</span><span class="hint">${esc(p.inventory?.quantityAvailable)} available</span></div>${review}</article>`;
  }
  function renderCurateProducts(products) {
    const cards = products.length
      ? products.map(curateCard).join('')
      : '<p class="empty">No new products to review.</p>';
    const pages =
      curateTotalPages > 1
        ? '<nav class="pager" aria-label="Product pages">' +
          Array.from(
            { length: curateTotalPages },
            (_, i) =>
              `<button class="${i + 1 === curatePage ? 'secondary' : 'outline'}" type="button" data-page-no="${i + 1}"${i + 1 === curatePage ? ' aria-current="page"' : ''}>${i + 1}</button>`,
          ).join('') +
          '</nav>'
        : '';
    $('admin-products').innerHTML =
      (products.length
        ? `<div class="product-grid curate-grid">${cards}</div>`
        : cards) + pages;
  }
  async function loadProducts() {
    const ids = [...artistFilter].join(',');
    const r = await call(
      `/admin/products?status=pending_review&page=${curatePage}${ids ? '&artistIds=' + ids : ''}`,
    );
    if (!r.products.length && r.page > 1) {
      curatePage = r.totalPages;
      return loadProducts();
    }
    curateTotalPages = r.totalPages;
    curateProducts = r.products;
    renderCurateProducts(curateProducts);
  }
  async function refreshModeration() {
    await Promise.all([loadProducts(), loadArtists(true)]);
  }
  $('moderation-refresh').onclick = () => run(refreshModeration);
  $('artist-search').oninput = (e) => {
    artistSearch = e.target.value;
    clearTimeout(artistSearchTimer);
    artistSearchTimer = setTimeout(() => run(() => loadArtists(true)), 300);
  };
  $('artist-filter-list').onclick = (e) => {
    if (e.target.closest('[data-show-more]')) run(() => loadArtists(false));
  };
  $('artist-filter-list').onchange = (e) => {
    const box = e.target;
    if (box.type !== 'checkbox') return;
    if (box.checked) artistFilter.add(box.value);
    else artistFilter.delete(box.value);
    curatePage = 1;
    renderArtistFilter();
    run(loadProducts);
  };
  // Opens beside the card; the last card in a row opens to the left, and single-column layouts open below.
  function toggleSusPanel(id) {
    const card = $('admin-products').querySelector(`[data-curate-card="${id}"]`);
    const panel = card?.querySelector(`[data-sus-panel="${id}"]`);
    if (!panel) return;
    const opening = panel.hidden;
    closeSusPanels();
    if (!opening) return;
    const grid = card.parentElement;
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const index = [...grid.children].indexOf(card);
    const side = cols === 1 ? 'below' : (index + 1) % cols === 0 ? 'left' : 'right';
    panel.dataset.side = side;
    panel.hidden = false;
  }
  function closeSusPanels() {
    for (const panel of $('admin-products').querySelectorAll('[data-sus-panel]')) {
      panel.hidden = true;
    }
  }
  // Saves what remains checked. Practices and certifications keep their original data, and only deselected items are removed.
  function saveKeptSustainability(id) {
    const product = curateProducts.find((p) => p._id === id);
    const panel = $('admin-products').querySelector(`[data-sus-panel="${id}"]`);
    if (!product || !panel) return;
    const original = product.sustainability || {};
    const kept = (key) => panel.querySelector(`[data-sus-keep="${key}"]`)?.checked !== false;
    const practices = (original.practices || []).filter((code) => kept(`practice:${code}`));
    const certifications = (original.certifications || [])
      .map((c, i) => ({ c, i }))
      .filter(({ i }) => kept(`cert:${i}`))
      .map(({ c, i }) => {
        const cert = {
          name: c.name,
          issuer: c.issuer,
          verified: panel.querySelector(`[data-cert-verified="${i}"]`).checked,
        };
        if (c.certificateUrl) cert.certificateUrl = c.certificateUrl;
        return cert;
      });
    run(async () => {
      await call(`/admin/products/${id}/sustainability`, 'PATCH', {
        sustainability: {
          practices,
          summary: original.summary || '',
          certifications,
        },
      });
      notify('Sustainability details updated');
      await loadProducts();
    });
  }
  $('admin-products').onclick = (e) => {
    const pageBtn = e.target.closest('[data-page-no]');
    if (pageBtn) {
      curatePage = Number(pageBtn.dataset.pageNo);
      run(loadProducts);
      return;
    }
    const titleLink = e.target.closest('[data-curate-details]');
    if (titleLink) {
      e.preventDefault();
      const product = curateProducts.find(
        (p) => p._id === titleLink.dataset.curateDetails,
      );
      if (!product) return;
      page('catalog');
      showProductDetails(product, 'curate');
      return;
    }
    const susEdit = e.target.closest('[data-sus-edit]');
    if (susEdit) {
      toggleSusPanel(susEdit.dataset.susEdit);
      return;
    }
    const susCancel = e.target.closest('[data-sus-cancel]');
    if (susCancel) {
      closeSusPanels();
      return;
    }
    const keptSave = e.target.closest('[data-save-kept]');
    if (keptSave) {
      saveKeptSustainability(keptSave.dataset.saveKept);
      return;
    }
    const b = e.target.closest('[data-review-id]');
    if (!b) return;
    const rateInput = $('admin-products').querySelector(
      `[data-commission="${b.dataset.reviewId}"]`,
    );
    if (
      b.dataset.reviewStatus === 'approved' &&
      rateInput.value.trim() === ''
    ) {
      notify('Enter a commission % before approving');
      return;
    }
    run(async () => {
      await call('/admin/products/' + b.dataset.reviewId + '/review', 'PATCH', {
        status: b.dataset.reviewStatus,
        commissionRate: Number(rateInput.value),
      });
      notify('Product moderation updated (original products remain protected)');
      await loadProducts();
    });
  };

  // Initial page always gives visitors usable browse and aggregation without authentication.
  run(refreshHome);
})();
