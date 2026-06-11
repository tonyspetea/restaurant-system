/**
 * auth.js — PIN login screen, session management, role gating
 */
const Auth = (() => {
  const SESSION_KEY = 'token';
  const USER_KEY    = 'current_user';

  function getUser() {
    try { return JSON.parse(sessionStorage.getItem(USER_KEY)); } catch { return null; }
  }
  function getToken() { return sessionStorage.getItem(SESSION_KEY); }
  function isLoggedIn() { return !!getToken(); }
  function role() { return getUser()?.role || ''; }
  function isAdmin()   { return role() === 'admin'; }
  function isManager() { return ['manager','admin'].includes(role()); }
  function isWaiter()  { return role() === 'waiter'; }

  function setSession(data) {
    sessionStorage.setItem(SESSION_KEY, data.token);
    sessionStorage.setItem(USER_KEY, JSON.stringify({
      id: data.user_id, name: data.name, role: data.role,
    }));
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(USER_KEY);
  }

  // ── Login Screen ──────────────────────────────────────────────────────────
  function showLoginScreen() {
    document.body.innerHTML = `
      <div id="login-screen" style="min-height:100dvh;display:flex;align-items:center;justify-content:center;background:var(--color-background-tertiary)">
        <div style="background:var(--color-background-primary);border:0.5px solid var(--color-border-secondary);border-radius:16px;padding:36px 32px;width:320px;text-align:center">
          <div style="font-size:40px;margin-bottom:8px">🍽</div>
          <div style="font-size:20px;font-weight:600;margin-bottom:4px">RestoPOS</div>
          <div style="font-size:13px;color:var(--color-text-secondary);margin-bottom:28px">Enter your 4-digit PIN</div>

          <div id="pin-display" style="display:flex;gap:10px;justify-content:center;margin-bottom:24px">
            ${[0,1,2,3].map(i=>`<div class="pin-dot" id="pd-${i}" style="width:16px;height:16px;border-radius:50%;background:var(--color-border-secondary);transition:background 0.15s"></div>`).join('')}
          </div>

          <div id="pin-error" style="color:#C8420A;font-size:13px;margin-bottom:12px;min-height:18px"></div>

          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:10px">
            ${[1,2,3,4,5,6,7,8,9].map(n=>`
              <button onclick="Auth.pinKey('${n}')" style="padding:16px;border-radius:10px;border:0.5px solid var(--color-border-secondary);background:var(--color-background-secondary);font-size:20px;font-weight:500;cursor:pointer;color:var(--color-text-primary);transition:background 0.1s" onmousedown="this.style.background='var(--color-border-secondary)'" onmouseup="this.style.background='var(--color-background-secondary)'">${n}</button>
            `).join('')}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
            <button onclick="Auth.pinClear()" style="padding:16px;border-radius:10px;border:0.5px solid var(--color-border-secondary);background:var(--color-background-secondary);font-size:13px;cursor:pointer;color:var(--color-text-secondary)">Clear</button>
            <button onclick="Auth.pinKey('0')" style="padding:16px;border-radius:10px;border:0.5px solid var(--color-border-secondary);background:var(--color-background-secondary);font-size:20px;font-weight:500;cursor:pointer;color:var(--color-text-primary)">0</button>
            <button onclick="Auth.pinBackspace()" style="padding:16px;border-radius:10px;border:0.5px solid var(--color-border-secondary);background:var(--color-background-secondary);font-size:18px;cursor:pointer;color:var(--color-text-secondary)">⌫</button>
          </div>

          <div style="margin-top:20px;font-size:11px;color:var(--color-text-secondary)">
            Default PINs: Admin 0000 · Manager 1111 · Waiter 2222
          </div>
        </div>
      </div>`;
  }

  let _pin = '';
  function pinKey(k) {
    if (_pin.length >= 4) return;
    _pin += k;
    updateDots();
    if (_pin.length === 4) setTimeout(submitPin, 200);
  }
  function pinBackspace() { _pin = _pin.slice(0,-1); updateDots(); }
  function pinClear()     { _pin = ''; updateDots(); setError(''); }
  function updateDots() {
    for (let i=0;i<4;i++) {
      const d = document.getElementById('pd-'+i);
      if (d) d.style.background = i < _pin.length ? '#C8420A' : 'var(--color-border-secondary)';
    }
  }
  function setError(msg) {
    const el = document.getElementById('pin-error');
    if (el) el.textContent = msg;
  }

  async function submitPin() {
    try {
      const data = await API.login({ pin: _pin });
      setSession(data);
      window.location.reload();
    } catch(e) {
      setError('Incorrect PIN — try again');
      _pin = '';
      updateDots();
    }
  }

  async function logout() {
    try { await API.logout(); } catch {}
    clearSession();
    window.location.reload();
  }

  // Keyboard PIN support
  document.addEventListener('keydown', e => {
    if (!document.getElementById('pin-display')) return;
    if (e.key >= '0' && e.key <= '9') pinKey(e.key);
    else if (e.key === 'Backspace') pinBackspace();
  });

  return { getUser, getToken, isLoggedIn, role, isAdmin, isManager, isWaiter,
           showLoginScreen, pinKey, pinBackspace, pinClear, logout };
})();
