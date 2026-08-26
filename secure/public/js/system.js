'use strict';

// System screen (SPEC.md §5.4, §9.4). *** THE XSS SINK LIVES HERE. ***
//
// SECURE build: customer names are written with textContent, so a payload like
// `<img src=x onerror="alert(document.cookie)">` renders as visible, inert TEXT — never parsed as
// markup (§10.1 fix). The vulnerable twin changes exactly these two writes to innerHTML (T17). The
// name is stored verbatim server-side in BOTH builds — the difference is purely at render.
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
    lastCustomer.textContent = customer.name; // SECURE render sink
  }

  function renderList(customers) {
    listEl.textContent = '';
    for (const customer of customers) {
      const li = document.createElement('li');
      li.className = 'list-group-item';
      li.textContent = customer.name; // SECURE render sink
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
