'use strict';

// Change-password page (SPEC.md §5.2). Server enforces the current-password check, the policy, and
// the reuse-history rule; the client only checks fields are non-empty and renders the server's
// error list as text.
(function () {
  const form = document.getElementById('change-form');
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
    const currentPassword = document.getElementById('cp-current').value;
    const newPassword = document.getElementById('cp-new').value;
    if (!currentPassword || !newPassword) {
      showErrors(['Both fields are required.']);
      return;
    }
    try {
      await window.api.post('/api/change-password', { currentPassword, newPassword });
      errorsBox.classList.add('d-none');
      successBox.textContent = 'Password changed.';
      successBox.classList.remove('d-none');
      form.reset();
    } catch (err) {
      if (err.status === 401 && /authentication required/i.test(err.message)) {
        window.location.href = '/index.html';
        return;
      }
      showErrors(err.details && err.details.length ? err.details : [err.message]);
    }
  });
})();
