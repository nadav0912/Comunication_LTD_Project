'use strict';

// Reset-password page (SPEC.md §5.5). The user pastes the emailed token plus a new password; the
// server validates the token, policy, and history, then unlocks the account. Errors render as text.
(function () {
  const form = document.getElementById('reset-form');
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
        li.textContent = msg;
        ul.appendChild(li);
      }
      errorsBox.appendChild(ul);
    }
    errorsBox.classList.remove('d-none');
    successBox.classList.add('d-none');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = document.getElementById('rp-token').value.trim();
    const newPassword = document.getElementById('rp-new').value;
    if (!token || !newPassword) {
      showErrors(['Token and new password are required.']);
      return;
    }
    try {
      await window.api.post('/api/reset', { token, newPassword });
      errorsBox.classList.add('d-none');
      successBox.textContent = 'Password reset. You can now log in.';
      successBox.classList.remove('d-none');
      setTimeout(() => { window.location.href = '/index.html'; }, 1500);
    } catch (err) {
      showErrors(err.details && err.details.length ? err.details : [err.message]);
    }
  });
})();
