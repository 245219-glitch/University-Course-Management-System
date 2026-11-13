/* UniSphere core: API (jQuery AJAX + JWT), Auth, UI helpers, app Shell */
const TOKEN_KEY = 'unisphere_token', USER_KEY = 'unisphere_user';
const HOME = { student: '/student.html', faculty: '/faculty.html', admin: '/admin.html' };

const Auth = {
  token: () => localStorage.getItem(TOKEN_KEY),
  save(token, user) { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); },
  clear() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); },
  logout() { Auth.clear(); location.href = '/index.html?reason=loggedout'; },
  expire(code) { Auth.clear(); location.href = '/index.html?reason=' + (code === 'TOKEN_EXPIRED' ? 'expired' : code === 'ACCOUNT_SUSPENDED' ? 'suspended' : 'invalid'); },
  async guard(role) {                       // front-end guard only; the server enforces everything again
    if (!Auth.token()) { location.replace('/index.html?reason=login'); return new Promise(() => {}); }
    try {
      const { user } = await API.get('/api/auth/me');
      if (user.role !== role) { location.replace(HOME[user.role]); return new Promise(() => {}); }
      return user;
    } catch (e) { return new Promise(() => {}); }
  }
};

const API = {
  request(method, url, data, opts = {}) {
    return new Promise((resolve, reject) => {
      const headers = Auth.token() ? { Authorization: 'Bearer ' + Auth.token() } : {};
      const cfg = { url, method, headers, dataType: opts.blob ? undefined : 'json' };
      if (opts.blob) cfg.xhrFields = { responseType: 'blob' };
      if (opts.form) { cfg.data = data; cfg.processData = false; cfg.contentType = false; }
      else if (data !== undefined && method === 'GET') cfg.data = data;
      else if (data !== undefined) { cfg.data = JSON.stringify(data); cfg.contentType = 'application/json'; }
      $.ajax(cfg).done((res) => resolve(res)).fail((xhr) => {
        const j = xhr.responseJSON || {};
        if (xhr.status === 401 && Auth.token() && url !== '/api/auth/login') { Auth.expire(j.code); return; }
        if (xhr.status === 403 && j.code === 'ACCOUNT_SUSPENDED') { Auth.expire(j.code); return; }
        const err = new Error(j.error || (xhr.status === 0 ? 'Cannot reach the server. Is it running?' : 'Request failed (' + xhr.status + ').'));
        err.status = xhr.status; err.code = j.code; reject(err);
      });
    });
  },
  get: (u, d) => API.request('GET', u, d), post: (u, d) => API.request('POST', u, d), put: (u, d) => API.request('PUT', u, d), del: (u) => API.request('DELETE', u),
  upload: (u, fd) => API.request('POST', u, fd, { form: true })
};

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const UI = {
  esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  date(s) { if (!s) return '-'; const d = new Date(String(s).slice(0, 10) + 'T00:00:00'); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); },
  dt(s) { if (!s) return '-'; const d = new Date(String(s).replace(' ', 'T')); return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); },
  time: (s) => String(s || '').slice(0, 5),
  badge: (t, tone = '') => `<span class="badge ${tone}">${UI.esc(t)}</span>`,
  tone(status) { return ({ enrolled: 'green', completed: 'blue', withdrawn: '', waitlisted: 'yellow', open: 'green', closed: 'red', pending: 'yellow', submitted: 'blue', late: 'red', graded: 'green', returned: 'yellow', overdue: 'red', active: 'green', suspended: 'red', in_progress: 'yellow', resolved: 'green', present: 'green', absent: 'red' })[status] || ''; },
  loading: () => '<div class="spinner">Loading…</div>',
  empty: (title, text = '') => `<div class="empty"><b>${UI.esc(title)}</b>${UI.esc(text)}</div>`,
  initials: (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(),
  bar(pct, threshold) {
    const p = Math.max(0, Math.min(100, pct || 0));
    const cls = threshold ? (p < threshold ? 'bad' : p < threshold + 8 ? 'warn' : '') : '';
    return `<div class="bar ${cls}"><i style="width:${p}%"></i>${threshold ? `<span class="mark" style="left:${threshold}%"></span>` : ''}</div>`;
  },
  toast(msg, type = 'info') {
    if (!$('#toasts').length) $('body').append('<div id="toasts" aria-live="polite"></div>');
    const $t = $('<div class="toast"></div>').addClass(type).text(msg).appendTo('#toasts');
    setTimeout(() => $t.fadeOut(250, () => $t.remove()), 4200);
  },
  fail: (e) => UI.toast(e.message || 'Something went wrong.', 'error'),
  async run(promise, okMsg) { try { const r = await promise; if (okMsg !== false) UI.toast(okMsg || r.message || 'Done.', 'success'); return r; } catch (e) { UI.fail(e); return null; } },

  table(cols, rows, emptyMsg = 'Nothing here yet.') {
    if (!rows.length) return UI.empty(emptyMsg);
    return `<div class="tbl-wrap"><table><thead><tr>${cols.map((c) => `<th>${c.h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) =>
      `<tr>${cols.map((c) => `<td class="${c.cls || ''}">${c.f(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  },
  field(label, name, o = {}) {
    const { type = 'text', value = '', req = true, options, attrs = '', placeholder = '' } = o;
    let input;
    if (type === 'select') input = `<select name="${name}" ${req ? 'required' : ''} ${attrs}>${options.map(([v, t]) => `<option value="${UI.esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${UI.esc(t)}</option>`).join('')}</select>`;
    else if (type === 'textarea') input = `<textarea name="${name}" ${req ? 'required' : ''} placeholder="${UI.esc(placeholder)}" ${attrs}>${UI.esc(value)}</textarea>`;
    else input = `<input type="${type}" name="${name}" value="${UI.esc(value)}" placeholder="${UI.esc(placeholder)}" ${req ? 'required' : ''} ${attrs}>`;
    return `<div class="field"><label>${label}</label>${input}</div>`;
  },
  values($form) {
    const out = {};
    $form.serializeArray().forEach(({ name, value }) => { if (name in out) out[name] = [].concat(out[name], value); else out[name] = value; });
    return out;
  },
  // Generic form modal. onSubmit(values, $modal) may throw -> error shown in modal. Return nothing to close.
  modal({ title, body, submit = 'Save', wide = false, onOpen, onSubmit, cancel = 'Cancel' }) {
    const $o = $(`<div class="overlay" role="dialog" aria-modal="true"><form class="modal ${wide ? 'wide' : ''}" novalidate>
      <div class="modal-head"><h3>${title}</h3><button type="button" class="x" aria-label="Close">×</button></div>
      <div class="m-err"></div>${body}
      ${onSubmit ? `<div class="modal-foot"><button type="button" class="btn ghost x2">${cancel}</button><button class="btn">${submit}</button></div>` : ''}</form></div>`).appendTo('body');
    const close = () => $o.remove();
    $o.find('.x,.x2').on('click', close); $o.on('mousedown', (e) => { if (e.target === $o[0]) close(); });
    $(document).one('keydown.modal', (e) => { if (e.key === 'Escape') close(); });
    const $f = $o.find('form');
    $f.on('submit', async (e) => {
      e.preventDefault(); if (!onSubmit) return;
      if (!$f[0].checkValidity()) { $f[0].reportValidity(); return; }
      const $b = $f.find('.modal-foot .btn:not(.ghost)').prop('disabled', true);
      try { const r = await onSubmit(UI.values($f), $o); if (r !== false) close(); }
      catch (err) { $o.find('.m-err').html(`<div class="form-error">${UI.esc(err.message)}</div>`); $o.find('.modal').scrollTop(0); }
      $b.prop('disabled', false);
    });
    if (onOpen) onOpen($o);
    $o.find('input:not([type=hidden]),select,textarea').first().trigger('focus');
    return { close, $el: $o };
  },
  confirm(message, ok = 'Confirm', danger = true) {
    return new Promise((resolve) => {
      let done = false;
      const m = UI.modal({ title: 'Please confirm', body: `<p>${UI.esc(message)}</p><div class="modal-foot"><button type="button" class="btn ghost c-no">Cancel</button><button type="button" class="btn ${danger ? 'danger' : ''} c-yes">${ok}</button></div>` });
      m.$el.find('.c-no,.x').on('click', () => { if (!done) { done = true; resolve(false); } });
      m.$el.find('.c-yes').on('click', () => { done = true; m.close(); resolve(true); });
    });
  },
  async download(url, filename) {
    try { const blob = await API.request('GET', url, undefined, { blob: true }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
    catch (e) { UI.toast(e.status === 403 ? 'You do not have access to this file.' : 'Download failed.', 'error'); }
  },
  charts: [],
  chart(canvas, cfg) { cfg.options = { animation: false, ...(cfg.options || {}) }; const c = new Chart(canvas, cfg); UI.charts.push(c); return c; },
  killCharts() { UI.charts.forEach((c) => c.destroy()); UI.charts = []; },
  theme(t) { document.documentElement.setAttribute('data-theme', t); localStorage.setItem('unisphere_theme', t); }
};
UI.theme(localStorage.getItem('unisphere_theme') || 'light');
const PALETTE = ['#C9605B', '#7E9F7A', '#E9BE62', '#6E97A3', '#F0B994', '#A98BB0'];

/* ---------------- Shell: sidebar, routing, notifications ---------------- */
const Shell = {
  user: null, routes: {}, title: '',
  async init({ role, nav, home }) {
    const user = await Auth.guard(role); Shell.user = user;
    $('#app').html(`<div class="app">
      <aside class="side" id="side"><div class="brand"><img src="/assets/logo.svg" alt="">UniSphere</div>
        <div class="chip"><div class="avatar">${UI.esc(UI.initials(user.full_name))}</div><div><b>${UI.esc(user.full_name)}</b><span>${role[0].toUpperCase() + role.slice(1)}</span></div></div>
        <nav class="nav" aria-label="Main">${nav.map((n) => n.hidden ? '' : n.group ? `<div class="group">${n.group}</div>` : `<a href="#${n.id}" data-id="${n.id}">${n.label}</a>`).join('')}</nav>
        <button class="btn ghost block" id="logout">Log out</button></aside>
      <div class="main"><div class="top"><div style="display:flex;gap:.7rem;align-items:center"><button class="icon-btn menu-btn" id="menu">Menu</button><span class="muted small" id="today"></span></div>
        <div class="tools"><div class="pos"><button class="icon-btn" id="bell" aria-label="Notifications">Notifications<span class="dot hidden" id="bellDot">0</span></button><div class="drop hidden" id="drop"></div></div>
        <button class="icon-btn" id="themeBtn">Theme</button></div></div><main id="view" tabindex="-1"></main></div></div>`);
    $('#today').text(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }));
    nav.filter((n) => n.render).forEach((n) => { Shell.routes[n.id] = n; });
    Shell.home = home;
    $('#logout').on('click', Auth.logout);
    $('#themeBtn').on('click', () => { UI.theme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); });
    $('#menu').on('click', () => $('#side').toggleClass('open'));
    $('#bell').on('click', (e) => { e.stopPropagation(); Shell.bell(); });
    $(document).on('click', (e) => { if (!$(e.target).closest('#drop').length) $('#drop').addClass('hidden'); if (!$(e.target).closest('#side,#menu').length) $('#side').removeClass('open'); });
    $(window).on('hashchange', Shell.route); Shell.route(); Shell.poll(); setInterval(Shell.poll, 60000);
  },
  async route() {
    const [id, ...args] = (location.hash.slice(1) || Shell.home).split('/');
    const r = Shell.routes[id] || Shell.routes[Shell.home];
    $('.nav a').removeClass('active').filter(`[data-id="${r.id}"]`).addClass('active'); $('#side').removeClass('open');
    UI.killCharts(); $('#view').html(UI.loading()); window.scrollTo(0, 0);
    try { await r.render($('#view'), ...args); } catch (e) { $('#view').html(`<div class="card"><div class="form-error">${UI.esc(e.message)}</div></div>`); }
  },
  async poll() { try { const d = await API.get('/api/notifications'); Shell.n = d; $('#bellDot').text(d.unread).toggleClass('hidden', !d.unread); } catch (e) { /* ignore */ } },
  async bell() {
    const $d = $('#drop'); if (!$d.hasClass('hidden')) return $d.addClass('hidden');
    await Shell.poll(); const d = Shell.n || { notifications: [] };
    $d.html((d.notifications.length ? `<div class="right" style="padding:.3rem"><button class="btn sm ghost" id="readAll">Mark all read</button></div>` : '') +
      (d.notifications.slice(0, 12).map((n) => `<div class="n ${n.is_read ? '' : 'unread'}"><b>${UI.esc(n.title)}</b>${UI.esc(n.message)}<div class="muted small">${UI.dt(n.created_at)}</div></div>`).join('') || UI.empty('All caught up', 'New notifications will appear here.'))).removeClass('hidden');
    $('#readAll').on('click', async () => { await API.put('/api/notifications/read-all'); Shell.poll(); $d.addClass('hidden'); });
  }
};

/* ---------------- Views shared by all roles ---------------- */
const Shared = {
  async updates($v) {
    const [a, n] = await Promise.all([API.get('/api/announcements'), API.get('/api/notifications')]);
    $v.html(`<h1>Updates</h1><div class="grid g2"><div class="card"><h3>Announcements</h3>${a.announcements.map((x) => `<div class="ann"><h4>${UI.esc(x.title)} ${x.course_code ? UI.badge(x.course_code, 'peach') : ''}</h4><p>${UI.esc(x.message)}</p><span class="muted small">${UI.esc(x.author || 'Administration')} · ${UI.dt(x.created_at)}</span></div>`).join('') || UI.empty('No announcements yet')}</div>
      <div class="card"><div class="card-head"><h3>Notifications</h3><button class="btn sm soft" id="ra">Mark all read</button></div>${n.notifications.map((x) => `<div class="list-item"><div><b>${UI.esc(x.title)}</b> ${x.is_read ? '' : UI.badge('new', 'yellow')}<div class="muted small">${UI.esc(x.message)}</div></div><span class="muted small">${UI.dt(x.created_at)}</span></div>`).join('') || UI.empty('No notifications')}</div></div>`);
    $('#ra').on('click', async () => { await API.put('/api/notifications/read-all'); Shell.poll(); Shared.updates($v); });
  },
  async calendar($v) {
    const { events } = await API.get('/api/calendar'); const tone = { deadline: 'red', exam: 'yellow', holiday: 'green', semester: 'blue', event: 'peach' };
    const today = new Date().toISOString().slice(0, 10), up = events.filter((e) => e.date >= today), past = events.filter((e) => e.date < today).slice(-5);
    $v.html(`<h1>Academic calendar</h1><div class="card">${up.map((e) => `<div class="list-item"><div><b>${UI.esc(e.title)}</b>${e.description ? `<div class="muted small">${UI.esc(e.description)}</div>` : ''}</div><div>${UI.badge(e.type, tone[e.type])} <span class="small">${UI.date(e.date)}</span></div></div>`).join('') || UI.empty('No upcoming dates')}</div>
      ${past.length ? `<div class="card"><h3>Recently passed</h3>${past.map((e) => `<div class="list-item muted"><span>${UI.esc(e.title)}</span><span>${UI.date(e.date)}</span></div>`).join('')}</div>` : ''}`);
  },
  async messages($v) {
    const [{ inbox, sent }, { recipients }] = await Promise.all([API.get('/api/messages'), API.get('/api/messages/recipients')]);
    $v.html(`<div class="card-head"><h1>Messages</h1><button class="btn" id="new">New message</button></div>
      <div class="grid g2"><div class="card"><h3>Inbox</h3>${inbox.map((m) => `<div class="list-item"><div><b>${UI.esc(m.subject)}</b> ${m.is_read ? '' : UI.badge('new', 'yellow')}<div class="muted small">From ${UI.esc(m.sender)} · ${UI.dt(m.created_at)}</div><p class="small" style="margin:.3rem 0 0">${UI.esc(m.body)}</p></div></div>`).join('') || UI.empty('Inbox is empty')}</div>
      <div class="card"><h3>Sent</h3>${sent.map((m) => `<div class="list-item"><div><b>${UI.esc(m.subject)}</b><div class="muted small">To ${UI.esc(m.recipient)} · ${UI.dt(m.created_at)}</div><p class="small" style="margin:.3rem 0 0">${UI.esc(m.body)}</p></div></div>`).join('') || UI.empty('Nothing sent yet')}</div></div>`);
    inbox.filter((m) => !m.is_read).forEach((m) => API.put(`/api/messages/${m.id}/read`).catch(() => {}));
    $('#new').on('click', () => UI.modal({ title: 'New message', submit: 'Send message',
      body: recipients.length ? UI.field('To', 'recipient_id', { type: 'select', options: recipients.map((r) => [r.id, `${r.full_name} (${r.role})`]) }) + UI.field('Subject', 'subject') + UI.field('Message', 'body', { type: 'textarea' }) : UI.empty('No one to message yet', 'You can message the instructors of courses you are enrolled in.'),
      onSubmit: async (v) => { const r = await API.post('/api/messages', v); UI.toast(r.message, 'success'); Shared.messages($v); } }));
  },
  async profile($v) {
    const { user: u } = await API.get('/api/auth/me');
    $v.html(`<h1>My profile</h1><div class="grid g2"><div class="card"><h3>Personal details</h3><form id="pf">${UI.field('Full name', 'full_name', { value: u.full_name })}
      ${UI.field('Email (cannot be changed)', 'email', { value: u.email, attrs: 'disabled', req: false })}${UI.field('Phone', 'phone', { value: u.phone || '', req: false })}${UI.field('About me', 'bio', { type: 'textarea', value: u.bio || '', req: false })}
      <button class="btn">Save profile</button></form></div>
      <div><div class="card"><h3>Change password</h3><form id="pw"><div class="field"><label>Current password</label><input type="password" name="current_password" required autocomplete="current-password"></div>
      <div class="field"><label>New password</label><input type="password" name="new_password" required minlength="8" autocomplete="new-password"><div class="muted small">At least 8 characters with a letter and a number.</div></div><button class="btn soft">Update password</button></form></div>
      ${u.role === 'student' ? Shared.idCard(u) : ''}</div></div>`);
    $('#pf').on('submit', async (e) => { e.preventDefault(); const r = await UI.run(API.put('/api/auth/profile', UI.values($('#pf')))); if (r) $('.chip b').text(UI.values($('#pf')).full_name); });
    $('#pw').on('submit', async (e) => { e.preventDefault(); if (await UI.run(API.post('/api/auth/change-password', UI.values($('#pw'))))) $('#pw')[0].reset(); });
  },
  idCard(u) {
    let seed = (u.id * 9301 + 49297) % 233280; const cells = Array.from({ length: 81 }, () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 > .5 ? '<i></i>' : '<i class="o"></i>'; }).join('');
    return `<div class="card"><h3>Digital student ID</h3><div class="idcard"><div class="brand" style="padding:0"><img src="/assets/logo.svg" alt="">UniSphere</div><h2 style="margin:.8rem 0 .1rem">${UI.esc(u.full_name)}</h2>
      <div>${UI.esc(u.program || '')}${u.semester_no ? ' · Semester ' + u.semester_no : ''}</div><div>${UI.esc(u.department_name || 'Department not set')}</div><div class="small">Reg. ${UI.esc(u.reg_no || '-')} · Member since ${UI.date(u.created_at)}</div><div class="qr" aria-hidden="true">${cells}</div></div></div>`;
  }
};
