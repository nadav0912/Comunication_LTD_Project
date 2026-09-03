'use strict';

// Register page. Client validation is convenience only: it checks fields are
// non-empty, then lets the SERVER enforce the real password policy and surface its error list
// (§2 — client JS is trivially bypassed; the test suite proves enforcement is server-side).
(function () {
  const form = document.getElementById('register-form');
  const errorsBox = document.getElementById('errors');
  const successBox = document.getElementById('success');

  function showErrors(messages) {
    errorsBox.textContent = '';
    if (messages.length === 1) {
      errorsBox.textContent = messages[0];
    } else {
      const ul = document.createElement('ul');
      ul.className = 'mb-0';
      for (const msg of messages) {
        const li = document.createElement('li');
        li.textContent = msg; // textContent — never inject server strings as markup
        ul.appendChild(li);
      }
      errorsBox.appendChild(ul);
    }
    errorsBox.classList.remove('d-none');
    successBox.classList.add('d-none');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = form.username.value.trim();
    const email = form.email.value.trim();
    const password = form.password.value;

    if (!username || !email || !password) {
      showErrors(['All fields are required.']);
      return;
    }

    try {
      await window.api.post('/api/register', { username, email, password });
      errorsBox.classList.add('d-none');
      successBox.textContent = 'Account created. Redirecting to login…';
      successBox.classList.remove('d-none');
      setTimeout(() => { window.location.href = '/index.html'; }, 1200);
    } catch (err) {
      showErrors(err.details && err.details.length ? err.details : [err.message]);
    }
  });
})();
