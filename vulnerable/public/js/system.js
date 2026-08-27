'use strict';

// System screen (SPEC.md §5.4, §9.4). *** THE XSS SINK LIVES HERE. ***
//
// !! INTENTIONALLY VULNERABLE — see SPEC.md §10.1 !!
// VULNERABLE build: customer names are written with innerHTML, so a stored payload like
// `<img src=x onerror="alert(document.cookie)">` is parsed as markup and EXECUTES — on submit and
// again on every page load (proving it is stored, not reflected). The secure twin uses textContent.
// The name is stored verbatim server-side in BOTH builds — the difference is purely at render.
(function () {
  const form = document.getElementById('customer-form');
  const lastCustomer = document.getElementById('lastCustomer');
  const listEl = document.getElementById('customer-list');
  const errorsBox = document.getElementById('errors');
  const logoutBtn = document.getElementById('logout');

  const field = (id) => document.getElementById(id).value.trim();

  function showError(message) {
    errorsBox.textContent = message;
    errorsBox.classList.remove('d-none');
  }

  function renderLast(customer) {
    // !! INTENTIONALLY VULNERABLE — see SPEC.md §10.1 !!
    // innerHTML parses the stored name as markup, so `<img src=x onerror=...>` executes. The secure
    // twin uses textContent. Storage is verbatim in both builds — the flaw lives here, at render.
    lastCustomer.innerHTML = customer.name;
  }

  function renderList(customers) {
    listEl.textContent = '';
    for (const customer of customers) {
      const li = document.createElement('li');
      li.className = 'list-group-item';
      // !! INTENTIONALLY VULNERABLE — see SPEC.md §10.1 !! (payload re-fires on every page load,
      // which is what proves the XSS is STORED, not reflected)
      li.innerHTML = customer.name;
      listEl.appendChild(li);
    }
  }

  async function loadCustomers() {
    renderList(await window.api.get('/api/customers'));
  }

  function toLogin() {
    window.location.href = '/index.html';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = field('cust-name');
    if (!name) {
      showError('Customer name is required.');
      return;
    }
    try {
      const customer = await window.api.post('/api/customers', {
        name,
        email: field('cust-email') || undefined,
        phone: field('cust-phone') || undefined,
        sector: field('cust-sector') || undefined,
        package: field('cust-package') || undefined,
      });
      errorsBox.classList.add('d-none');
      renderLast(customer);
      await loadCustomers();
      form.reset();
    } catch (err) {
      if (err.status === 401) return toLogin();
      showError(err.message);
    }
  });

  logoutBtn.addEventListener('click', async () => {
    try { await window.api.post('/api/logout'); } catch { /* ignore */ }
    toLogin();
  });

  // Customer search (the GET /api/customers?search= path; secure renders results with textContent).
  const searchInput = document.getElementById('cust-search');
  async function runSearch() {
    const term = searchInput.value.trim();
    if (!term) return loadCustomers();
    try {
      renderList(await window.api.get('/api/customers?search=' + encodeURIComponent(term)));
    } catch (err) {
      if (err.status === 401) return toLogin();
      showError(err.message);
    }
  }
  document.getElementById('search-btn').addEventListener('click', runSearch);
  document.getElementById('clear-btn').addEventListener('click', () => {
    searchInput.value = '';
    loadCustomers();
  });
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); runSearch(); }
  });

  // On load: require a session, then render the stored list (payloads persist and re-fire here).
  (async () => {
    try {
      await window.api.get('/api/me');
    } catch {
      return toLogin();
    }
    await loadCustomers();
  })();
})();
