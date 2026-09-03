'use strict';

// Forgot-password page. The response is intentionally the same whether or not the
// email exists, so the message here is generic — the server does not reveal account existence.
(function () {
  const form = document.getElementById('forgot-form');
  const errorsBox = document.getElementById('errors');
  const successBox = document.getElementById('success');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('fp-email').value.trim();
    if (!email) {
      errorsBox.textContent = 'Email is required.';
      errorsBox.classList.remove('d-none');
      return;
    }
    try {
      await window.api.post('/api/forgot', { email });
      errorsBox.classList.add('d-none');
      successBox.textContent = 'If that account exists, a reset token has been emailed. '
        + 'Continue to the reset page to enter it.';
      successBox.classList.remove('d-none');
    } catch (err) {
      errorsBox.textContent = err.message;
      errorsBox.classList.remove('d-none');
    }
  });
})();
