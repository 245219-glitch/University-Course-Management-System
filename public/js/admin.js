/* Administrator control centre */
let LK = null;
const lookups = async (force) => (LK = !LK || force ? await API.get('/api/courses/meta/lookups') : LK);
const opts = (list, label = 'name', none) => (none ? [['', none]] : []).concat(list.map((x) => [x.id, x[label]]));

const Admin = {
  async overview($v) {
    const d = await API.get('/api/admin/stats'), t = d.totals;
    $v.html(`<div class="hero-banner"><div><h1>University overview</h1><div>A live look at people, courses and activity across UniSphere.</div></div></div>
      <div class="stats"><div class="stat"><b>${t.students}</b><span>Students</span></div><div class="stat"><b>${t.faculty}</b><span>Faculty</span></div><div class="stat"><b>${t.departments}</b><span>Departments</span></div><div class="stat"><b>${t.courses}</b><span>Courses</span></div><div class="stat"><b>${t.active_enrolments}</b><span>Active enrolments</span></div>
      <div class="stat"><b>${t.waitlisted}</b><span>On waiting lists</span></div><div class="stat"><b>${t.open_tickets}</b><span>Open help tickets</span></div><div class="stat"><b>${t.suspended}</b><span>Suspended accounts</span></div></div>
      <div class="grid g2"><div class="card"><h3>Enrolment by course</h3><div style="height:280px"><canvas id="c1"></canvas></div></div><div class="card"><h3>Active enrolments by student department</h3><div style="height:280px"><canvas id="c2"></canvas></div></div></div>
      <div class="grid g2"><div class="card"><h3>Courses nearly full</h3>${d.nearly_full.map((c) => `<div style="margin-bottom:.7rem"><div class="list-item" style="border:0;padding:0"><span><b>${UI.esc(c.code)}</b> ${UI.esc(c.title)}</span><span>${c.enrolled}/${c.capacity}${c.waitlisted ? ' · ' + c.waitlisted + ' waiting' : ''}</span></div>${UI.bar(Math.round(c.enrolled / c.capacity * 100), 90)}</div>`).join('') || UI.empty('No course is above 80% capacity')}</div>
      <div class="card"><h3>Recent activity</h3>${d.recent_activity.map((a) => `<div class="list-item"><div><b>${UI.esc(a.action.replace(/_/g, ' ').toLowerCase())}</b><div class="muted small">${UI.esc(a.full_name || 'System')} · ${UI.esc(a.details || '')}</div></div><span class="muted small">${UI.dt(a.created_at)}</span></div>`).join('') || UI.empty('No activity yet')}</div></div>
      <div class="card"><h3>Enrolments in the last 30 days</h3>${d.trend.length ? '<div style="height:230px"><canvas id="c3"></canvas></div>' : UI.empty('No enrolments in the last 30 days')}</div>`);
    const pc = d.per_course.slice(0, 10);
    UI.chart($('#c1')[0], { type: 'bar', data: { labels: pc.map((c) => c.code), datasets: [{ label: 'Enrolled', data: pc.map((c) => c.enrolled), backgroundColor: '#C9605B', borderRadius: 6 }, { label: 'Capacity', data: pc.map((c) => c.capacity), backgroundColor: '#F2D9C4', borderRadius: 6 }] }, options: { maintainAspectRatio: false } });
    UI.chart($('#c2')[0], { type: 'doughnut', data: { labels: d.per_department.map((x) => x.name), datasets: [{ data: d.per_department.map((x) => x.enrolments), backgroundColor: PALETTE }] }, options: { maintainAspectRatio: false } });
    if (d.trend.length) UI.chart($('#c3')[0], { type: 'bar', data: { labels: d.trend.map((x) => UI.date(x.day)), datasets: [{ label: 'New enrolments', data: d.trend.map((x) => x.n), backgroundColor: '#7E9F7A', borderRadius: 6, maxBarThickness: 60 }] }, options: { maintainAspectRatio: false } });
  },

  async users($v) {
    const lk = await lookups(true);
    $v.html(`<div class="card-head"><h1>People</h1><button class="btn" id="nu">Add user</button></div><div class="toolbar"><input type="search" id="q" placeholder="Search name, email or reg. no"><select id="r"><option value="">All roles</option><option value="student">Students</option><option value="faculty">Faculty</option><option value="admin">Admins</option></select><select id="s"><option value="">Any status</option><option value="active">Active</option><option value="suspended">Suspended</option></select></div><div class="card" id="ul">${UI.loading()}</div>`);
    let users = [];
    const load = async () => {
      users = (await API.get('/api/admin/users', { search: $('#q').val(), role: $('#r').val(), status: $('#s').val() })).users;
      $('#ul').html(UI.table([{ h: 'Name', f: (u) => `<b>${UI.esc(u.full_name)}</b><div class="muted small">${UI.esc(u.email)}</div>` }, { h: 'Role', f: (u) => UI.badge(u.role, u.role === 'admin' ? 'red' : u.role === 'faculty' ? 'blue' : 'peach') }, { h: 'Program', f: (u) => u.program ? `${UI.esc(u.program)}${u.semester_no ? ' · Sem ' + u.semester_no : ''}` : '-' }, { h: 'Reg. no', f: (u) => UI.esc(u.reg_no || '-') },
        { h: 'Status', f: (u) => UI.badge(u.status, UI.tone(u.status)) }, { h: 'Last login', f: (u) => u.last_login ? UI.dt(u.last_login) : 'Never' }, { h: '', cls: 'right', f: (u) => `<div class="actions"><button class="btn sm soft" data-e="${u.id}">Edit</button><button class="btn sm ghost" data-p="${u.id}">Reset password</button></div>` }], users, 'No users match.'));
    };
    let t; $('#q').on('input', () => { clearTimeout(t); t = setTimeout(load, 250); }); $('#r,#s').on('change', load); load();
    const form = (u = {}) => UI.field('Full name', 'full_name', { value: u.full_name }) + (u.id ? '' : UI.field('Email', 'email', { type: 'email' }) + UI.field('Temporary password', 'password', { type: 'text', attrs: 'minlength="8"' })) +
      `<div class="row">${UI.field('Role', 'role', { type: 'select', value: u.role || 'student', options: [['student', 'Student'], ['faculty', 'Faculty'], ['admin', 'Administrator']] })}${u.id ? UI.field('Status', 'status', { type: 'select', value: u.status, options: [['active', 'Active'], ['suspended', 'Suspended']] }) : ''}</div>
      <div class="row">${UI.field('Department', 'department_id', { type: 'select', req: false, value: u.department_id || '', options: opts(lk.departments, 'name', 'None') })}${UI.field('Registration / staff no.', 'reg_no', { req: false, value: u.reg_no || '' })}</div><div class="row">${UI.field('Program (students)', 'program', { req: false, value: u.program || '', placeholder: 'BSCS' })}${UI.field('Semester no.', 'semester_no', { type: 'number', req: false, value: u.semester_no || '', attrs: 'min="1" max="12"' })}</div>`;
    $('#nu').on('click', () => UI.modal({ title: 'Add user', submit: 'Create account', body: form(), onSubmit: async (v) => { const r = await API.post('/api/admin/users', v); UI.toast(r.message, 'success'); load(); } }));
    $v.off('click.u').on('click.u', '[data-e]', function () { const u = users.find((x) => x.id === +$(this).data('e')); UI.modal({ title: 'Edit user', body: form(u), onSubmit: async (v) => { const r = await API.put('/api/admin/users/' + u.id, v); UI.toast(r.message, 'success'); load(); } }); })
      .on('click.u', '[data-p]', function () { const u = users.find((x) => x.id === +$(this).data('p')); UI.modal({ title: `Reset password for ${UI.esc(u.full_name)}`, submit: 'Reset password', body: UI.field('New password', 'new_password', { attrs: 'minlength="8"' }), onSubmit: async (v) => { const r = await API.put(`/api/admin/users/${u.id}/password`, v); UI.toast(r.message, 'success'); } }); });
  },

  async courses($v) {
    const lk = await lookups(true);
    $v.html(`<div class="card-head"><h1>Courses</h1><button class="btn" id="nc">Add course</button></div><div class="toolbar"><input type="search" id="q" placeholder="Search by name or code"><select id="dep"><option value="">All departments</option>${lk.departments.map((d) => `<option value="${d.id}">${UI.esc(d.name)}</option>`).join('')}</select></div><div class="card" id="cl">${UI.loading()}</div>`);
    let courses = [];
    const load = async () => {
      courses = (await API.get('/api/courses', { search: $('#q').val(), department_id: $('#dep').val() })).courses;
      $('#cl').html(UI.table([{ h: 'Course', f: (c) => `<b>${UI.esc(c.code)}</b> ${UI.esc(c.title)}<div class="muted small">${UI.esc(c.department_name || '')} · ${c.credit_hours} credits · ${UI.esc(c.semester_name || 'No semester')}</div>` }, { h: 'Instructor', f: (c) => UI.esc(c.instructor_name || 'Unassigned') },
        { h: 'Seats', f: (c) => `${c.enrolled_count}/${c.capacity}${c.waitlist_count ? ` <span class="muted small">(+${c.waitlist_count})</span>` : ''}` }, { h: 'Status', f: (c) => UI.badge(c.status, UI.tone(c.status)) }, { h: 'Schedule', f: (c) => c.slots.map((s) => `${DAYS[s.day_of_week].slice(0, 3)} ${UI.time(s.start_time)}`).join(', ') || '-' },
        { h: '', cls: 'right', f: (c) => `<div class="actions"><button class="btn sm soft" data-e="${c.id}">Edit</button><button class="btn sm danger" data-d="${c.id}">Delete</button></div>` }], courses, 'No courses yet. Add your first course.'));
    };
    let t; $('#q').on('input', () => { clearTimeout(t); t = setTimeout(load, 250); }); $('#dep').on('change', load); load();

    const slotRow = (s = {}) => `<div class="row slot-row" style="margin-bottom:.5rem;align-items:end"><select class="sd">${[1, 2, 3, 4, 5, 6].map((d) => `<option value="${d}" ${s.day_of_week === d ? 'selected' : ''}>${DAYS[d]}</option>`).join('')}</select><input type="time" class="ss" value="${UI.time(s.start_time) || '09:00'}"><input type="time" class="se" value="${UI.time(s.end_time) || '10:30'}"><div style="display:flex;gap:.3rem"><input type="text" class="sr" placeholder="Room" value="${UI.esc(s.room || '')}"><button type="button" class="btn sm ghost rm">×</button></div></div>`;
    const courseForm = (c = {}) => `<div class="row">${UI.field('Course code', 'code', { value: c.code, placeholder: 'CS-301' })}${UI.field('Credit hours', 'credit_hours', { type: 'number', value: c.credit_hours || 3, attrs: 'min="1" max="6"' })}</div>${UI.field('Title', 'title', { value: c.title })}${UI.field('Description', 'description', { type: 'textarea', req: false, value: c.description || '' })}
      <div class="row">${UI.field('Department', 'department_id', { type: 'select', req: false, value: c.department_id || '', options: opts(lk.departments, 'name', 'None') })}${UI.field('Semester', 'semester_id', { type: 'select', req: false, value: c.semester_id || '', options: opts(lk.semesters, 'name', 'None') })}</div>
      <div class="row">${UI.field('Instructor', 'instructor_id', { type: 'select', req: false, value: c.instructor_id || '', options: opts(lk.faculty, 'full_name', 'Unassigned') })}${UI.field('Capacity', 'capacity', { type: 'number', value: c.capacity || 40, attrs: 'min="1" max="500"' })}${UI.field('Registration', 'status', { type: 'select', value: c.status || 'open', options: [['open', 'Open'], ['closed', 'Closed']] })}</div>
      <div class="field"><label>Prerequisites</label><div class="checks">${lk.courses.filter((x) => x.id !== c.id).map((x) => `<label><input type="checkbox" name="prerequisites" value="${x.id}" ${(c.prerequisites || []).some((p) => p.id === x.id) ? 'checked' : ''}> ${UI.esc(x.code)}</label>`).join('') || '<span class="muted small">No other courses yet</span>'}</div></div>
      <div class="field"><label>Weekly class slots</label><div id="slots">${(c.slots || []).map(slotRow).join('')}</div><button type="button" class="btn sm soft" id="addSlot">Add slot</button></div>`;
    const submitCourse = (id) => async (v, $m) => {
      const body = { ...v, prerequisites: [].concat(v.prerequisites || []).map(Number), slots: $m.find('.slot-row').map((i, r) => ({ day_of_week: +$(r).find('.sd').val(), start_time: $(r).find('.ss').val(), end_time: $(r).find('.se').val(), room: $(r).find('.sr').val() })).get() };
      const r = await (id ? API.put('/api/courses/' + id, body) : API.post('/api/courses', body)); UI.toast(r.message, 'success'); load();
    };
    const slotsUi = ($m) => { $m.on('click', '#addSlot', () => $m.find('#slots').append(slotRow())).on('click', '.rm', function () { $(this).closest('.slot-row').remove(); }); };
    $('#nc').on('click', () => UI.modal({ title: 'Add course', wide: true, submit: 'Create course', body: courseForm(), onOpen: slotsUi, onSubmit: submitCourse(null) }));
    $v.off('click.c').on('click.c', '[data-e]', function () { const c = courses.find((x) => x.id === +$(this).data('e')); UI.modal({ title: `Edit ${UI.esc(c.code)}`, wide: true, body: courseForm(c), onOpen: slotsUi, onSubmit: submitCourse(c.id) }); })
      .on('click.c', '[data-d]', async function () { const c = courses.find((x) => x.id === +$(this).data('d')); if (await UI.confirm(`Delete ${c.code} - ${c.title}? ${c.enrolled_count ? c.enrolled_count + ' enrolled students will lose this course. ' : ''}This cannot be undone.`, 'Delete course') && await UI.run(API.del('/api/courses/' + c.id))) load(); });
  },

  async departments($v) {
    const { departments: d } = await API.get('/api/admin/departments');
    $v.html(`<div class="card-head"><h1>Departments</h1><button class="btn" id="nd">Add department</button></div><div class="card">${UI.table([{ h: 'Department', f: (x) => `<b>${UI.esc(x.name)}</b>` }, { h: 'Code', f: (x) => UI.esc(x.code) }, { h: 'Courses', f: (x) => x.courses }, { h: 'Students', f: (x) => x.students }, { h: 'Faculty', f: (x) => x.faculty }, { h: '', cls: 'right', f: (x) => `<div class="actions"><button class="btn sm soft" data-e="${x.id}">Edit</button><button class="btn sm danger" data-d="${x.id}">Delete</button></div>` }], d, 'No departments yet.')}</div>`);
    const f = (x = {}) => UI.field('Name', 'name', { value: x.name }) + UI.field('Short code', 'code', { value: x.code, placeholder: 'CS' });
    $('#nd').on('click', () => UI.modal({ title: 'Add department', body: f(), onSubmit: async (v) => { const r = await API.post('/api/admin/departments', v); UI.toast(r.message, 'success'); Admin.departments($v); } }));
    $v.off('click.d').on('click.d', '[data-e]', function () { const x = d.find((y) => y.id === +$(this).data('e')); UI.modal({ title: 'Edit department', body: f(x), onSubmit: async (v) => { const r = await API.put('/api/admin/departments/' + x.id, v); UI.toast(r.message, 'success'); Admin.departments($v); } }); })
      .on('click.d', '[data-d]', async function () { if (await UI.confirm('Delete this department? Its courses and people stay but lose their department.', 'Delete') && await UI.run(API.del('/api/admin/departments/' + $(this).data('d')))) Admin.departments($v); });
  },

  async semesters($v) {
    const [{ semesters: s }, cal, lk] = await Promise.all([API.get('/api/admin/semesters'), API.get('/api/calendar'), lookups(true)]);
    $v.html(`<div class="card-head"><h1>Semesters & calendar</h1><button class="btn" id="ns">Add semester</button></div>
      <div class="card"><h3>Semesters</h3>${UI.table([{ h: 'Semester', f: (x) => `<b>${UI.esc(x.name)}</b> ${x.is_current ? UI.badge('current', 'green') : ''}` }, { h: 'Dates', f: (x) => `${UI.date(x.start_date)} to ${UI.date(x.end_date)}` }, { h: 'Registration', f: (x) => UI.badge(x.registration_open ? 'open' : 'closed', x.registration_open ? 'green' : 'red') }, { h: 'Courses', f: (x) => x.courses }, { h: '', cls: 'right', f: (x) => `<div class="actions"><button class="btn sm soft" data-e="${x.id}">Edit</button><button class="btn sm danger" data-d="${x.id}">Delete</button></div>` }], s, 'No semesters yet.')}</div>
      <div class="card"><h3>Smart timetable generator</h3><p class="muted small">Gives every unscheduled course in a semester a weekly slot and room, avoiding instructor, room and same-department clashes. Courses that already have a schedule are left alone.</p>
        <div class="toolbar"><select id="gs">${s.map((x) => `<option value="${x.id}">${UI.esc(x.name)}</option>`).join('')}</select><button class="btn sage" id="gen">Generate timetable</button></div></div>
      <div class="card"><div class="card-head"><h3>Academic calendar events</h3><button class="btn sm" id="ne">Add event</button></div>${UI.table([{ h: 'Date', f: (e) => UI.date(e.date) }, { h: 'Event', f: (e) => UI.esc(e.title) }, { h: 'Type', f: (e) => UI.badge(e.type, 'peach') }, { h: '', cls: 'right', f: (e) => e.id ? `<button class="btn sm danger" data-ce="${e.id}">Remove</button>` : '<span class="muted small">from semester dates</span>' }], cal.events, 'No events.')}</div>`);
    const f = (x = {}) => UI.field('Name', 'name', { value: x.name, placeholder: 'Spring 2027' }) + `<div class="row">${UI.field('Starts', 'start_date', { type: 'date', value: x.start_date })}${UI.field('Ends', 'end_date', { type: 'date', value: x.end_date })}</div><div class="field"><label><input type="checkbox" name="registration_open" value="1" ${x.registration_open ? 'checked' : ''}> Registration is open</label></div><div class="field"><label><input type="checkbox" name="is_current" value="1" ${x.is_current ? 'checked' : ''}> This is the current semester</label></div>`;
    const sv = (v) => ({ ...v, registration_open: !!v.registration_open, is_current: !!v.is_current });
    $('#ns').on('click', () => UI.modal({ title: 'Add semester', body: f({ registration_open: 1 }), onSubmit: async (v) => { const r = await API.post('/api/admin/semesters', sv(v)); UI.toast(r.message, 'success'); Admin.semesters($v); } }));
    $('#ne').on('click', () => UI.modal({ title: 'Add calendar event', body: UI.field('Title', 'title') + `<div class="row">${UI.field('Date', 'event_date', { type: 'date' })}${UI.field('Type', 'type', { type: 'select', options: [['deadline', 'Deadline'], ['exam', 'Exam'], ['holiday', 'Holiday'], ['event', 'Event']] })}</div>`, onSubmit: async (v) => { const r = await API.post('/api/admin/calendar', v); UI.toast(r.message, 'success'); Admin.semesters($v); } }));
    $('#gen').on('click', async function () { $(this).prop('disabled', true); const r = await UI.run(API.post('/api/admin/timetable/generate', { semester_id: +$('#gs').val() })); $(this).prop('disabled', false); if (r) lookups(true); });
    $v.off('click.s').on('click.s', '[data-e]', function () { const x = s.find((y) => y.id === +$(this).data('e')); UI.modal({ title: 'Edit semester', body: f(x), onSubmit: async (v) => { const r = await API.put('/api/admin/semesters/' + x.id, sv(v)); UI.toast(r.message, 'success'); Admin.semesters($v); } }); })
      .on('click.s', '[data-d]', async function () { if (await UI.confirm('Delete this semester? Courses stay but lose their semester.', 'Delete') && await UI.run(API.del('/api/admin/semesters/' + $(this).data('d')))) Admin.semesters($v); })
      .on('click.s', '[data-ce]', async function () { if (await UI.run(API.del('/api/admin/calendar/' + $(this).data('ce')))) Admin.semesters($v); });
  },

  async enrollments($v) {
    const lk = await lookups();
    $v.html(`<h1>Enrolment monitor</h1><div class="toolbar"><select id="cs"><option value="">All courses</option>${lk.courses.map((c) => `<option value="${c.id}">${UI.esc(c.code)} ${UI.esc(c.title)}</option>`).join('')}</select></div><div class="card" id="el">${UI.loading()}</div>`);
    const load = async () => { const { enrollments: e } = await API.get('/api/admin/enrollments', { course_id: $('#cs').val() }); $('#el').html(UI.table([{ h: 'Student', f: (x) => `<b>${UI.esc(x.full_name)}</b><div class="muted small">${UI.esc(x.email)}</div>` }, { h: 'Course', f: (x) => `${UI.esc(x.code)} ${UI.esc(x.title)}` }, { h: 'Status', f: (x) => UI.badge(x.status, UI.tone(x.status)) }, { h: 'Grade', f: (x) => x.grade_letter || '-' }, { h: 'Date', f: (x) => UI.date(x.enrolled_at) }], e, 'No enrolments found.')); };
    $('#cs').on('change', load); load();
  },

  async announcements($v) {
    const { announcements: a } = await API.get('/api/admin/announcements');
    $v.html(`<h1>Announcements</h1><div class="card"><h3>Publish an announcement</h3><form id="af">${UI.field('Title', 'title')}${UI.field('Message', 'message', { type: 'textarea' })}${UI.field('Audience', 'audience', { type: 'select', options: [['all', 'Everyone'], ['students', 'Students only'], ['faculty', 'Faculty only']] })}<button class="btn">Publish</button></form></div>
      <div class="card"><h3>Published</h3>${a.map((x) => `<div class="ann"><div class="card-head" style="margin:0"><h4>${UI.esc(x.title)} ${UI.badge(x.audience, 'peach')}</h4><button class="btn sm danger" data-d="${x.id}">Delete</button></div><p>${UI.esc(x.message)}</p><span class="muted small">${UI.esc(x.author || '')} · ${UI.dt(x.created_at)}</span></div>`).join('') || UI.empty('Nothing published yet')}</div>`);
    $('#af').on('submit', async function (e) { e.preventDefault(); if (await UI.run(API.post('/api/admin/announcements', UI.values($(this))))) Admin.announcements($v); });
    $v.off('click.a').on('click.a', '[data-d]', async function () { if (await UI.run(API.del('/api/admin/announcements/' + $(this).data('d')))) Admin.announcements($v); });
  },

  async tickets($v) {
    const [{ tickets: t }, lk] = await Promise.all([API.get('/api/admin/tickets'), lookups()]);
    $v.html(`<h1>Help desk</h1>${t.map((x) => `<div class="card"><div class="card-head"><h3>${UI.esc(x.subject)}</h3><div>${UI.badge(x.category, 'peach')} ${UI.badge(x.status.replace('_', ' '), UI.tone(x.status))} ${x.department_name ? UI.badge(x.department_name, 'blue') : ''}</div></div><p>${UI.esc(x.message)}</p><div class="muted small">${UI.esc(x.full_name)} · ${UI.esc(x.email)} · ${UI.dt(x.created_at)}</div>${x.response ? `<div class="ann" style="margin-top:.6rem"><b>Reply:</b> ${UI.esc(x.response)}</div>` : ''}<div style="margin-top:.7rem"><button class="btn sm soft" data-t="${x.id}">Respond / assign</button></div></div>`).join('') || `<div class="card">${UI.empty('No tickets', 'Student requests will arrive here.')}</div>`}`);
    $v.off('click.t').on('click.t', '[data-t]', function () { const x = t.find((y) => y.id === +$(this).data('t'));
      UI.modal({ title: 'Update ticket', submit: 'Save', body: `<p><b>${UI.esc(x.subject)}</b></p>` + UI.field('Status', 'status', { type: 'select', value: x.status, options: [['open', 'Open'], ['in_progress', 'In progress'], ['resolved', 'Resolved']] }) + UI.field('Assign to department', 'department_id', { type: 'select', req: false, value: x.department_id || '', options: opts(lk.departments, 'name', 'Not assigned') }) + UI.field('Reply to student', 'response', { type: 'textarea', req: false, value: x.response || '' }),
        onSubmit: async (v) => { const r = await API.put('/api/admin/tickets/' + x.id, v); UI.toast(r.message, 'success'); Admin.tickets($v); } }); });
  },

  async audit($v) {
    const { logs } = await API.get('/api/admin/audit-logs');
    $v.html(`<h1>Audit log</h1><div class="card">${UI.table([{ h: 'When', f: (l) => UI.dt(l.created_at) }, { h: 'Who', f: (l) => UI.esc(l.full_name || 'System') }, { h: 'Action', f: (l) => UI.badge(l.action.replace(/_/g, ' '), l.action.includes('FAIL') ? 'red' : 'peach') }, { h: 'Details', f: (l) => UI.esc(l.details || '') }, { h: 'IP', f: (l) => UI.esc(l.ip || '') }], logs, 'No activity recorded.')}</div>`);
  },

  async reports($v) {
    $v.html(`<h1>Reports</h1><div class="grid g2"><div class="card"><h3>Course enrolment report</h3><p class="muted">Every course with its instructor, capacity, enrolled count and waiting list. Opens in Excel.</p><button class="btn" data-r="enrolments">Download CSV</button></div>
      <div class="card"><h3>Student report</h3><p class="muted">All students with department, status, current courses and CGPA.</p><button class="btn" data-r="students">Download CSV</button></div></div>`);
    $v.off('click.r').on('click.r', '[data-r]', function () { const t = $(this).data('r'); UI.download('/api/admin/reports/' + t, t + '-report.csv'); });
  },

  async settings($v) {
    const { settings: s } = await API.get('/api/admin/settings');
    $v.html(`<h1>System settings</h1><div class="card" style="max-width:560px"><form id="sf">${UI.field('Maximum credit hours per student per semester', 'max_credits', { type: 'number', value: s.max_credits, attrs: 'min="1" max="30"' })}${UI.field('Minimum attendance (%)', 'attendance_threshold', { type: 'number', value: s.attendance_threshold, attrs: 'min="0" max="100"' })}${UI.field('Passing percentage', 'passing_percentage', { type: 'number', value: s.passing_percentage, attrs: 'min="0" max="100"' })}<button class="btn">Save settings</button></form></div>`);
    $('#sf').on('submit', async function (e) { e.preventDefault(); await UI.run(API.put('/api/admin/settings', UI.values($(this)))); });
  }
};

$(function () {
  Shell.init({ role: 'admin', home: 'overview', nav: [
    { id: 'overview', label: 'Overview', render: Admin.overview }, { group: 'University' }, { id: 'users', label: 'People', render: Admin.users }, { id: 'courses', label: 'Courses', render: Admin.courses }, { id: 'departments', label: 'Departments', render: Admin.departments }, { id: 'semesters', label: 'Semesters & calendar', render: Admin.semesters }, { id: 'enrollments', label: 'Enrolments', render: Admin.enrollments },
    { group: 'Communication' }, { id: 'announcements', label: 'Announcements', render: Admin.announcements }, { id: 'tickets', label: 'Help desk', render: Admin.tickets }, { id: 'messages', label: 'Messages', render: Shared.messages },
    { group: 'System' }, { id: 'reports', label: 'Reports', render: Admin.reports }, { id: 'audit', label: 'Audit log', render: Admin.audit }, { id: 'settings', label: 'Settings', render: Admin.settings }, { id: 'profile', label: 'Profile', render: Shared.profile }] });
});
