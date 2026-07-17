// The login/register gate. The game is account-gated: main.js waits on
// authenticate() before connecting, so it always has a session token. We POST
// the credentials to the server's /login or /register (see
// server/internal/auth) and resolve with the token from the response.
//
// The overlay markup lives in index.html; this module only drives it.

export function authenticate() {
  const overlay = document.getElementById('auth');
  const form = document.getElementById('auth-form');
  const usernameEl = document.getElementById('auth-username');
  const passwordEl = document.getElementById('auth-password');
  const errorEl = document.getElementById('auth-error');

  return new Promise(resolve => {
    // Whichever button submitted the form decides the endpoint.
    let action = 'login';
    for (const button of form.querySelectorAll('button[data-action]')) {
      button.addEventListener('click', () => { action = button.dataset.action; });
    }

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const username = usernameEl.value.trim();
      const password = passwordEl.value;
      if (!username || !password) return;

      errorEl.textContent = '';
      setDisabled(form, true);
      try {
        const res = await fetch(`/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        if (!res.ok) {
          errorEl.textContent = await errorText(res, action);
          return;
        }
        const { token } = await res.json();
        overlay.remove();
        resolve(token);
      } catch {
        errorEl.textContent = 'Cannot reach the server.';
      } finally {
        setDisabled(form, false);
      }
    });
  });
}

function setDisabled(form, disabled) {
  for (const el of form.querySelectorAll('input, button')) el.disabled = disabled;
}

async function errorText(res, action) {
  if (res.status === 401) return 'Wrong username or password.';
  if (res.status === 409) return 'That username is already taken.';
  const body = (await res.text()).trim();
  return body || `${action === 'login' ? 'Login' : 'Registration'} failed (${res.status}).`;
}
