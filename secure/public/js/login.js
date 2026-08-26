'use strict';

// Login page (SPEC.md §5.3). On success the server sets the session cookie and we move to the
// system screen. The distinct "does not exist" vs "incorrect password" messages (deviation D1) come
// straight from the server, rendered as text.
(function () {
  const form = document.getElementById('login-form');
  const errorsBox = document.getElementById('errors');

  function showError(message) {
    errorsBox.textContent = message;
    errorsBox.classList.remove('d-none');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = form.username.value.trim();
    const password = form.password.value;
    if (!username || !password) {
      showError('Username and password are required.');
      return;
    }
    try {
      await window.api.post('/api/login', { username, password });
      window.location.href = '/system.html';
    } catch (err) {
      showError(err.message);
    }
  });
})();
