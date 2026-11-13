$(async function () {
  const reasons = { expired: ['Your session has expired. Please log in again.', 'form-error'], invalid: ['Please log in to continue.', 'form-error'], login: ['Please log in to continue.', 'form-error'],
    suspended: ['This account has been suspended. Contact the administrator.', 'form-error'], loggedout: ['You have been logged out.', 'form-ok'] };
  const r = new URLSearchParams(location.search).get('reason');
  if (reasons[r]) $('#msg').html(`<div class="${reasons[r][1]}">${reasons[r][0]}</div>`);

  if (Auth.token() && !r) { try { const { user } = await API.get('/api/auth/me'); location.replace(HOME[user.role]); return; } catch (e) { /* stay */ } }

  const PORTALS = {
    student: { title: 'Student login', btn: 'Log in as student', demo: 'Demo student:<br><code>tehreem@unisphere.edu</code> / Student@123<br>Others: hania@, zainab@, hira@unisphere.edu (same password)' },
    faculty: { title: 'Teacher login', btn: 'Log in as teacher', demo: 'Demo teachers (password Faculty@123):<br><code>fahad@unisphere.edu</code> (Full Stack Dev)<br><code>kamran@unisphere.edu</code> (DSA) · <code>ghulam@unisphere.edu</code> (Advisory) · <code>mansoor@unisphere.edu</code> (DAA)' },
    admin: { title: 'Admin login', btn: 'Log in as admin', demo: 'Demo admin:<br><code>coco@unisphere.edu</code> / Admin@12345' }
  };
  let role = ['student', 'faculty', 'admin'].includes(new URLSearchParams(location.search).get('role')) ? new URLSearchParams(location.search).get('role') : 'student';
  const setRole = (r, keep) => {
    role = r; $('.rp').each(function () { const on = $(this).data('role') === r; $(this).toggleClass('on', on).attr('aria-checked', on); });
    $('#portalTitle').text(PORTALS[r].title); $('#loginBtn').text(PORTALS[r].btn); $('#demo').html(PORTALS[r].demo);
    $('#seg').toggleClass('hidden', r !== 'student');     // only students can self-register
    if (r !== 'student') { show('login'); $('#msg').html(`<div class="form-ok">${r === 'admin' ? 'Administrator' : 'Teacher'} accounts are created by the university administrator.</div>`); }
    else if (!keep) $('#msg').empty();
    $('#portalTitle').toggleClass('hidden', $('#register').is(':visible'));
  };
  $('.rp').on('click', function () { setRole($(this).data('role')); });
  const show = (which) => { $('#login').toggleClass('hidden', which !== 'login'); $('#register').toggleClass('hidden', which !== 'reg'); $('#tabLogin').toggleClass('on', which === 'login'); $('#tabReg').toggleClass('on', which === 'reg'); $('#msg').empty(); };
  $('#tabLogin').on('click', () => { show('login'); $('#portalTitle').removeClass('hidden'); }); $('#tabReg').on('click', () => { show('reg'); $('#portalTitle').addClass('hidden'); });
  $('.toggle').on('click', function () { const $i = $(this).siblings('input'); const show = $i.attr('type') === 'password'; $i.attr('type', show ? 'text' : 'password'); $(this).text(show ? 'Hide' : 'Show'); });
  const err = (m) => $('#msg').html(`<div class="form-error" role="alert">${UI.esc(m)}</div>`);

  $('#login').on('submit', async function (e) {
    e.preventDefault(); const v = UI.values($(this)); const $b = $(this).find('button.btn').prop('disabled', true).text('Logging in…');
    if (!v.email || !v.password) { err('Enter your email and password.'); $b.prop('disabled', false).text(PORTALS[role].btn); return; }
    try { const d = await API.post('/api/auth/login', { ...v, role }); Auth.save(d.token, d.user); location.href = HOME[d.user.role]; }
    catch (ex) { err(ex.message); $b.prop('disabled', false).text(PORTALS[role].btn); }
  });
  $('#register').on('submit', async function (e) {
    e.preventDefault(); const v = UI.values($(this));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) return err('Please enter a valid email address.');
    if (v.password.length < 8 || !/[A-Za-z]/.test(v.password) || !/\d/.test(v.password)) return err('Password needs 8+ characters with a letter and a number.');
    const $b = $(this).find('button.btn').prop('disabled', true);
    try { await API.post('/api/auth/register', v); this.reset(); show('login'); $('#le').val(v.email); $('#msg').html('<div class="form-ok">Account created. You can log in now.</div>'); }
    catch (ex) { err(ex.message); }
    $b.prop('disabled', false);
  });
  setRole(role, true);
});
