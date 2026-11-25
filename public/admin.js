(() => {
  const TOKEN_KEY = 'alex_admin_token';
  const USER_KEY = 'alex_admin_user';

  const loginSection = document.getElementById('login-section');
  const dashboardSection = document.getElementById('dashboard-section');
  const sessionBar = document.getElementById('session-bar');
  const adminBadge = document.getElementById('admin-badge');
  const logoutBtn = document.getElementById('logout-btn');
  const globalStatus = document.getElementById('global-status');

  const loginForm = document.getElementById('login-form');
  const loginSubmit = document.getElementById('login-submit');
  const createUserForm = document.getElementById('create-user-form');
  const createUserSubmit = document.getElementById('create-user-submit');

  const roleSelect = document.getElementById('new-role');
  const branchField = document.getElementById('branch-field');
  const branchSelect = document.getElementById('new-branch-select');
  const branchInput = document.getElementById('new-branch-input');
  const deviceInput = document.getElementById('new-device-id');
  const refreshUsersBtn = document.getElementById('refresh-users-btn');
  const usersTbody = document.getElementById('users-tbody');

  let useManualBranch = false;

  function showStatus(message, type) {
    globalStatus.textContent = message;
    globalStatus.className = `status-banner ${type}`;
    globalStatus.hidden = false;
  }

  function clearStatus() {
    globalStatus.hidden = true;
    globalStatus.textContent = '';
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function syncBranchRequirement() {
    const isEmployee = roleSelect.value === 'employee';
    branchField.hidden = !isEmployee;

    if (useManualBranch) {
      branchSelect.hidden = true;
      branchSelect.required = false;
      branchInput.hidden = false;
      branchInput.required = isEmployee;
    } else {
      branchInput.hidden = true;
      branchInput.required = false;
      branchSelect.hidden = false;
      branchSelect.required = isEmployee;
    }
  }

  async function apiFetch(url, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  async function loadBranches() {
    try {
      const { res, data } = await apiFetch('/api/auth/branches');
      if (!res.ok) {
        useManualBranch = true;
        syncBranchRequirement();
        return;
      }

      const branches = Array.isArray(data.data) ? data.data : [];
      branchSelect.innerHTML = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'اختر الفرع...';
      branchSelect.appendChild(placeholder);

      if (branches.length === 0) {
        useManualBranch = true;
      } else {
        useManualBranch = false;
        for (const b of branches) {
          const opt = document.createElement('option');
          opt.value = String(b.id);
          opt.textContent = `${b.name || 'فرع'} (#${b.id})`;
          branchSelect.appendChild(opt);
        }
      }
      syncBranchRequirement();
    } catch {
      useManualBranch = true;
      syncBranchRequirement();
    }
  }

  async function loadUsers() {
    usersTbody.innerHTML = '';
    const loadingRow = document.createElement('tr');
    const loadingCell = document.createElement('td');
    loadingCell.colSpan = 5;
    loadingCell.className = 'empty-cell';
    loadingCell.textContent = 'جارٍ تحميل المستخدمين...';
    loadingRow.appendChild(loadingCell);
    usersTbody.appendChild(loadingRow);

    try {
      const { res, data } = await apiFetch('/api/auth/users');
      if (res.status === 401 || res.status === 403) {
        clearSession();
        renderView();
        showStatus('انتهت الجلسة أو ليس لديك صلاحية الأدمن. يرجى تسجيل الدخول مجدداً.', 'error');
        return;
      }
      if (!res.ok) {
        throw new Error(data.message || 'تعذر تحميل المستخدمين');
      }

      const users = Array.isArray(data.data) ? data.data : [];
      usersTbody.innerHTML = '';

      if (users.length === 0) {
        const emptyRow = document.createElement('tr');
        const emptyCell = document.createElement('td');
        emptyCell.colSpan = 5;
        emptyCell.className = 'empty-cell';
        emptyCell.textContent = 'لا يوجد مستخدمون مسجلون حالياً.';
        emptyRow.appendChild(emptyCell);
        usersTbody.appendChild(emptyRow);
        return;
      }

      for (const u of users) {
        const tr = document.createElement('tr');

        const tdUser = document.createElement('td');
        tdUser.textContent = u.username;

        const tdEmail = document.createElement('td');
        tdEmail.textContent = u.email;

        const tdRole = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = `role-pill ${u.role}`;
        badge.textContent = u.role;
        tdRole.appendChild(badge);

        const tdBranch = document.createElement('td');
        tdBranch.textContent = u.branch_id != null ? String(u.branch_id) : '—';

        const tdDevice = document.createElement('td');
        tdDevice.textContent = u.device_id ? String(u.device_id) : '—';

        tr.append(tdUser, tdEmail, tdRole, tdBranch, tdDevice);
        usersTbody.appendChild(tr);
      }
    } catch (err) {
      usersTbody.innerHTML = '';
      const errRow = document.createElement('tr');
      const errCell = document.createElement('td');
      errCell.colSpan = 5;
      errCell.className = 'empty-cell';
      errCell.textContent = err.message || 'حدث خطأ أثناء تحميل القائمة';
      errRow.appendChild(errCell);
      usersTbody.appendChild(errRow);
    }
  }

  function renderView() {
    const token = getToken();
    let user = null;
    try {
      user = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
      user = null;
    }

    const isAdmin = Boolean(token && user && user.role === 'admin');
    loginSection.hidden = isAdmin;
    dashboardSection.hidden = !isAdmin;
    sessionBar.hidden = !isAdmin;

    if (isAdmin) {
      adminBadge.textContent = `${user.username} (${user.role})`;
      syncBranchRequirement();
      loadBranches();
      loadUsers();
    }
  }

  document.querySelectorAll('.toggle-pw').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      if (!target) return;
      const show = target.type === 'password';
      target.type = show ? 'text' : 'password';
      btn.textContent = show ? 'إخفاء' : 'إظهار';
      btn.setAttribute('aria-pressed', String(show));
    });
  });

  roleSelect.addEventListener('change', syncBranchRequirement);
  refreshUsersBtn.addEventListener('click', loadUsers);

  logoutBtn.addEventListener('click', () => {
    clearSession();
    clearStatus();
    loginForm.reset();
    renderView();
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearStatus();

    if (!loginForm.checkValidity()) {
      const firstInvalid = loginForm.querySelector(':invalid');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    const identifier = document.getElementById('login-identifier').value.trim();
    const password = document.getElementById('login-password').value;

    loginSubmit.disabled = true;
    try {
      const { res, data } = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: identifier, password }),
      });

      if (!res.ok) {
        showStatus(data.message || 'بيانات الدخول غير صحيحة', 'error');
        return;
      }

      if (!data.user || data.user.role !== 'admin') {
        showStatus('هذا الحساب لا يملك صلاحية الأدمن للدخول إلى لوحة الإدارة.', 'error');
        return;
      }

      setSession(data.token, data.user);
      loginForm.reset();
      showStatus('تم تسجيل دخول الأدمن بنجاح.', 'success');
      renderView();
    } catch {
      showStatus('تعذر الاتصال بالخادم، حاول مرة أخرى.', 'error');
    } finally {
      loginSubmit.disabled = false;
    }
  });

  createUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearStatus();

    if (!createUserForm.checkValidity()) {
      const firstInvalid = createUserForm.querySelector(':invalid');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    const username = document.getElementById('new-username').value.trim();
    const email = document.getElementById('new-email').value.trim();
    const password = document.getElementById('new-password').value;
    const role = roleSelect.value;

    let branchId = null;
    if (role === 'employee') {
      const rawBranch = useManualBranch ? branchInput.value : branchSelect.value;
      branchId = Number(rawBranch);
    }

    const rawDeviceId = deviceInput.value.trim();
    const deviceId = rawDeviceId ? rawDeviceId : null;

    createUserSubmit.disabled = true;
    try {
      const { res, data } = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          username,
          email,
          password,
          role,
          branch_id: branchId,
          device_id: deviceId,
        }),
      });

      if (!res.ok) {
        const firstErr = Array.isArray(data.errors) && data.errors[0]?.message;
        showStatus(firstErr || data.message || 'فشل إنشاء المستخدم', 'error');
        return;
      }

      showStatus(`تم إنشاء المستخدم (${data.user.username}) بصلاحية (${data.user.role}) بنجاح.`, 'success');
      createUserForm.reset();
      syncBranchRequirement();
      await loadUsers();
    } catch {
      showStatus('تعذر الاتصال بالخادم أثناء إنشاء المستخدم.', 'error');
    } finally {
      createUserSubmit.disabled = false;
    }
  });

  // Consistent ARIA + :user-invalid fallback from modern-web-guidance
  const linkError = (el, shown) => {
    const errorId = el.dataset.error;
    if (!errorId) return;
    const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== errorId);
    if (shown) ids.push(errorId);
    if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
    else el.removeAttribute('aria-describedby');
  };

  const announcer = document.createElement('div');
  announcer.setAttribute('aria-live', 'polite');
  announcer.classList.add('visually-hidden');
  document.body.append(announcer);
  let announceTimer;
  let announcedField;

  const spokenText = (node) => {
    const copy = node.cloneNode(true);
    copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
    copy.querySelectorAll('[role="img"][aria-label]').forEach((n) => n.replaceWith(`${n.getAttribute('aria-label')}: `));
    return copy.textContent.replace(/\s+/g, ' ').trim();
  };

  const announceError = (el) => {
    const error = document.getElementById(el.dataset.error);
    if (!error) return;
    const label = el.labels?.[0] ? `${spokenText(el.labels[0])}: ` : '';
    clearTimeout(announceTimer);
    announcer.textContent = '';
    announcedField = el;
    announceTimer = setTimeout(() => { announcer.textContent = label + spokenText(error); }, 500);
  };

  const supportsUserInvalid = CSS.supports('selector(:user-invalid)');
  const dirtyState = new WeakMap();
  const flagged = new WeakSet();
  const announced = new WeakSet();

  const syncAria = (el, announce = false) => {
    if (!el.matches?.('input, select, textarea')) return;
    const invalid = supportsUserInvalid
      ? el.matches(':user-invalid')
      : el.classList.contains('user-invalid-fallback');
    if (invalid) {
      if (announce && !announced.has(el)) {
        announceError(el);
        announced.add(el);
      }
      el.setAttribute('aria-invalid', 'true');
      linkError(el, true);
      flagged.add(el);
    } else if (flagged.has(el) || el.getAttribute('aria-invalid') !== 'true') {
      el.setAttribute('aria-invalid', 'false');
      linkError(el, false);
      flagged.delete(el);
      announced.delete(el);
      if (announcedField === el) {
        clearTimeout(announceTimer);
        announcer.textContent = '';
      }
    }
  };

  if (!supportsUserInvalid) {
    const updateFallback = (input) => {
      const isValid = input.validity.valid;
      input.classList.toggle('user-invalid-fallback', !isValid);
      input.classList.toggle('user-valid-fallback', isValid);
    };
    document.addEventListener('blur', (e) => {
      if (!e.target.checkValidity) return;
      const state = dirtyState.get(e.target) || { hasInteracted: false, hasBlurred: false };
      state.hasBlurred = true;
      dirtyState.set(e.target, state);
      if (state.hasInteracted) updateFallback(e.target);
    }, true);
    document.addEventListener('input', (e) => {
      if (!e.target.checkValidity) return;
      const state = dirtyState.get(e.target) || { hasInteracted: false, hasBlurred: false };
      state.hasInteracted = true;
      dirtyState.set(e.target, state);
      if (state.hasBlurred) updateFallback(e.target);
    });
    document.addEventListener('invalid', (e) => {
      if (!e.target.checkValidity) return;
      dirtyState.set(e.target, { hasInteracted: true, hasBlurred: true });
      updateFallback(e.target);
    }, true);
  }

  document.querySelectorAll('input, select, textarea').forEach((el) => syncAria(el));
  document.addEventListener('blur', (e) => syncAria(e.target, true), true);
  document.addEventListener('input', (e) => {
    if (e.target.hasAttribute('aria-invalid')) syncAria(e.target);
  });
  document.addEventListener('change', (e) => syncAria(e.target, true), true);
  document.addEventListener('invalid', (e) => {
    announced.add(e.target);
    syncAria(e.target);
  }, true);
  document.addEventListener('reset', (e) => {
    setTimeout(() => [...e.target.elements].forEach((el) => {
      dirtyState.delete(el);
      el.classList.remove('user-invalid-fallback', 'user-valid-fallback');
      syncAria(el);
    }));
  }, true);

  renderView();
})();
