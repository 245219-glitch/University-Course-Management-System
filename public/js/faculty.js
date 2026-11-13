/* Faculty portal */
const Faculty = {
  courseCards(courses) {
    return courses.length ? `<div class="grid g3">${courses.map((c) => `<article class="course"><div class="code">${UI.esc(c.code)} · ${c.credit_hours} credit hours</div><h3><a href="#course/${c.id}" style="color:inherit;text-decoration:none">${UI.esc(c.title)}</a></h3>
      <div class="meta"><span>${UI.esc(c.semester_name || '')}</span><span>${c.students} of ${c.capacity} students</span></div>${UI.bar(Math.round(c.students / c.capacity * 100))}<div class="foot"><span></span><a class="btn sm" href="#course/${c.id}">Open class</a></div></article>`).join('')}</div>` : `<div class="card">${UI.empty('No courses assigned yet', 'The administrator will assign your courses.')}</div>`;
  },
  async dashboard($v) {
    const d = await API.get('/api/faculty/dashboard'), s = d.stats, today = new Date().getDay() || 7;
    $v.html(`<div class="hero-banner"><div><h1>Welcome, ${UI.esc(Shell.user.full_name)}</h1><div>Here is your teaching overview.</div></div></div>
      <div class="stats"><div class="stat"><b>${s.courses}</b><span>Courses you teach</span></div><div class="stat"><b>${s.students}</b><span>Students</span></div><div class="stat"><b>${s.to_grade}</b><span>Submissions to grade</span></div><div class="stat"><b>${s.open_assignments}</b><span>Open assignments</span></div></div>
      <div class="card"><h3>Today's classes</h3>${d.schedule.filter((x) => x.day_of_week === today).map((x) => `<div class="list-item"><div><b>${UI.esc(x.code)} ${UI.esc(x.title)}</b></div><span>${UI.time(x.start_time)}-${UI.time(x.end_time)} ${x.room ? '· ' + UI.esc(x.room) : ''}</span></div>`).join('') || UI.empty('No classes today', 'Enjoy the quiet, or catch up on grading.')}</div>
      <h2>My courses</h2>${Faculty.courseCards(d.courses)}`);
  },
  async courses($v) { const d = await API.get('/api/faculty/dashboard'); $v.html(`<h1>My courses</h1>${Faculty.courseCards(d.courses)}`); },
  async schedule($v) {
    const d = await API.get('/api/faculty/dashboard');
    $v.html(`<h1>Teaching schedule</h1><div class="card">${d.schedule.length ? `<div class="tt">${[1, 2, 3, 4, 5, 6].map((n) => `<div><h4>${DAYS[n]}</h4>${d.schedule.filter((x) => x.day_of_week === n).map((x) => `<div class="slot"><b>${UI.esc(x.code)}</b>${UI.time(x.start_time)}-${UI.time(x.end_time)}<br>${UI.esc(x.room || 'Room TBA')}</div>`).join('') || '<div class="muted small">Free</div>'}</div>`).join('')}</div>` : UI.empty('No scheduled classes')}</div>`);
  },

  async course($v, id, tab = 'students') {
    id = +id; const base = `/api/faculty/courses/${id}`;
    const { course, students, threshold } = await API.get(base + '/students');
    const tabs = [['students', 'Students'], ['attendance', 'Attendance'], ['assignments', 'Assignments'], ['materials', 'Materials'], ['grades', 'Grades'], ['announce', 'Announce'], ['insights', 'Insights']];
    $v.html(`<p><a href="#courses">Back to my courses</a></p><h1>${UI.esc(course.code)} · ${UI.esc(course.title)}</h1><div class="tabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`).join('')}</div><div id="tab">${UI.loading()}</div>`);
    $v.find('.tabs button').on('click', function () { Faculty.course($v, id, $(this).data('t')); });
    const $t = $('#tab'); const reload = () => Faculty.course($v, id, tab);

    if (tab === 'students') {
      $t.html(`<div class="card">${UI.table([{ h: 'Student', f: (s) => `<b>${UI.esc(s.full_name)}</b><div class="muted small">${UI.esc(s.email)}</div>` }, { h: 'Reg. no', f: (s) => UI.esc(s.reg_no || '-') },
        { h: 'Attendance', f: (s) => s.attendance === null ? '-' : `${s.attendance}% ${s.attendance < threshold ? UI.badge('low', 'red') : ''}` }, { h: 'Status', f: (s) => s.status === 'completed' ? UI.badge(`${s.grade_letter} · ${s.final_percentage}%`, 'blue') : UI.badge('enrolled', 'green') }], students, 'No students enrolled yet.')}</div>`);
    }
    if (tab === 'attendance') {
      const date = $v.data('att') || new Date().toISOString().slice(0, 10); const d = await API.get(`${base}/attendance`, { date });
      $t.html(`<div class="card"><div class="toolbar"><label>Class date <input type="date" id="ad" value="${d.date}" max="${new Date().toISOString().slice(0, 10)}"></label><button class="btn soft sm" id="allp">Mark all present</button></div>
        ${d.records.length ? UI.table([{ h: 'Student', f: (r) => `<b>${UI.esc(r.full_name)}</b> <span class="muted small">${UI.esc(r.reg_no || '')}</span>` }, { h: 'Status', f: (r) => ['present', 'late', 'absent'].map((s) => `<label style="margin-right:.8rem"><input type="radio" name="s${r.student_id}" value="${s}" ${(r.status || '') === s ? 'checked' : ''}> ${s[0].toUpperCase() + s.slice(1)}</label>`).join('') }], d.records) : UI.empty('No enrolled students')}
        <div style="margin-top:1rem"><button class="btn" id="saveAtt">Save attendance</button></div><p class="small muted">Students who fall below ${threshold}% are notified automatically. ${d.dates.length} class days recorded so far.</p></div>`);
      $('#ad').on('change', function () { $v.data('att', this.value); reload(); });
      $('#allp').on('click', () => d.records.forEach((r) => $(`input[name=s${r.student_id}][value=present]`).prop('checked', true)));
      $('#saveAtt').on('click', async () => {
        const records = d.records.map((r) => ({ student_id: r.student_id, status: $(`input[name=s${r.student_id}]:checked`).val() })).filter((r) => r.status);
        if (!records.length) return UI.toast('Mark at least one student first.', 'warning');
        const r = await UI.run(API.post(`${base}/attendance`, { date: $('#ad').val(), records })); if (r && r.warned) UI.toast(`${r.warned} student(s) were warned about low attendance.`, 'warning');
      });
    }
    if (tab === 'assignments') {
      const { assignments } = await API.get(base + '/assignments');
      $t.html(`<div class="card"><div class="card-head"><h3>Assignments</h3><button class="btn" id="na">New assignment</button></div>${UI.table([{ h: 'Title', f: (a) => `<b>${UI.esc(a.title)}</b>` }, { h: 'Due', f: (a) => UI.dt(a.due_date) }, { h: 'Marks', f: (a) => a.max_marks }, { h: 'Submissions', f: (a) => `${a.submissions} ${a.to_grade ? UI.badge(a.to_grade + ' to grade', 'yellow') : ''}` }, { h: '', cls: 'right', f: (a) => `<button class="btn sm soft" data-sub="${a.id}">Review</button>` }], assignments, 'No assignments yet.')}</div>`);
      $('#na').on('click', () => UI.modal({ title: 'New assignment', submit: 'Publish assignment', body: UI.field('Title', 'title') + UI.field('Instructions', 'description', { type: 'textarea', req: false }) + `<div class="row">${UI.field('Due date and time', 'due_date', { type: 'datetime-local' })}${UI.field('Maximum marks', 'max_marks', { type: 'number', value: 100, attrs: 'min="1" max="1000"' })}</div>`,
        onSubmit: async (v) => { const r = await API.post(base + '/assignments', v); UI.toast(r.message, 'success'); reload(); } }));
      $t.on('click', '[data-sub]', async function () {
        const { assignment, submissions } = await API.get(`/api/faculty/assignments/${$(this).data('sub')}/submissions`);
        const m = UI.modal({ title: `Submissions: ${UI.esc(assignment.title)}`, wide: true, body: UI.table([{ h: 'Student', f: (s) => `<b>${UI.esc(s.full_name)}</b><div class="muted small">${UI.dt(s.submitted_at)}</div>` }, { h: 'Work', f: (s) => `${s.file_name ? `<a href="#" data-f="${s.id}" data-n="${UI.esc(s.file_name)}">${UI.esc(s.file_name)}</a>` : ''}${s.text_answer ? `<div class="small">${UI.esc(s.text_answer)}</div>` : ''}` }, { h: 'Status', f: (s) => UI.badge(s.status, UI.tone(s.status)) }, { h: 'Marks', f: (s) => `<input type="number" step="0.5" min="0" max="${assignment.max_marks}" value="${s.marks ?? ''}" data-m="${s.id}" style="width:80px"> / ${assignment.max_marks}` }, { h: 'Feedback', f: (s) => `<input type="text" data-fb="${s.id}" value="${UI.esc(s.feedback || '')}" maxlength="500">` }, { h: '', f: (s) => `<div class="actions"><button type="button" class="btn sm" data-g="${s.id}">Grade</button><button type="button" class="btn sm ghost" data-r="${s.id}">Return</button></div>` }], submissions, 'No submissions yet.') });
        m.$el.on('click', '[data-f]', (e) => { e.preventDefault(); UI.download('/api/files/submissions/' + $(e.currentTarget).data('f'), $(e.currentTarget).data('n')); })
          .on('click', '[data-g],[data-r]', async function () { const sid = $(this).data('g') || $(this).data('r'), ret = !!$(this).data('r'); await UI.run(API.put(`/api/faculty/submissions/${sid}/grade`, { marks: m.$el.find(`[data-m=${sid}]`).val(), feedback: m.$el.find(`[data-fb=${sid}]`).val(), status: ret ? 'returned' : 'graded' })); });
      });
    }
    if (tab === 'materials') {
      const { materials } = await API.get(base + '/materials');
      $t.html(`<div class="card"><div class="card-head"><h3>Learning materials</h3><button class="btn" id="um">Upload material</button></div>${UI.table([{ h: 'Title', f: (m) => `<b>${UI.esc(m.title)}</b><div class="muted small">${UI.esc(m.file_name)}</div>` }, { h: 'Uploaded', f: (m) => UI.date(m.uploaded_at) }, { h: '', cls: 'right', f: (m) => `<div class="actions"><button class="btn sm soft" data-dl="${m.id}" data-n="${UI.esc(m.file_name)}">Download</button><button class="btn sm danger" data-del="${m.id}">Remove</button></div>` }], materials, 'Nothing uploaded yet.')}</div>`);
      $('#um').on('click', () => UI.modal({ title: 'Upload material', submit: 'Upload', body: UI.field('Title', 'title', { req: false, placeholder: 'e.g. Week 3 slides' }) + '<div class="field"><label>File (PDF, slides, docs, ZIP - max 10 MB)</label><input type="file" name="file" required></div>',
        onSubmit: async (v, $m) => { const r = await API.upload(base + '/materials', new FormData($m.find('form')[0])); UI.toast(r.message, 'success'); reload(); } }));
      $t.on('click', '[data-dl]', function () { UI.download('/api/files/materials/' + $(this).data('dl'), $(this).data('n')); })
        .on('click', '[data-del]', async function () { if (await UI.confirm('Remove this material for all students?', 'Remove') && await UI.run(API.del(`${base}/materials/${$(this).data('del')}`))) reload(); });
    }
    if (tab === 'grades') {
      const { grades } = await API.get(base + '/grades');
      $t.html(`<div class="card"><div class="card-head"><h3>Grade book</h3><button class="btn" id="ag">Add grade</button></div>${UI.table([{ h: 'Student', f: (g) => UI.esc(g.full_name) }, { h: 'Component', f: (g) => `${UI.esc(g.title)} ${UI.badge(g.component, 'peach')}` }, { h: 'Marks', f: (g) => `${g.marks} / ${g.max_marks}` }, { h: 'Weight', f: (g) => g.weight + '%' }, { h: '', cls: 'right', f: (g) => `<button class="btn sm danger" data-del="${g.id}">Delete</button>` }], grades, 'No grades recorded yet.')}</div>
        <div class="card"><h3>Publish final grades</h3><p class="muted small">Calculates each student's weighted percentage, assigns a letter grade and marks the course completed for that student.</p>${UI.table([{ h: 'Student', f: (s) => UI.esc(s.full_name) }, { h: 'Status', f: (s) => s.status === 'completed' ? UI.badge(`${s.grade_letter} · ${s.final_percentage}%`, 'blue') : UI.badge('enrolled', 'green') }, { h: '', cls: 'right', f: (s) => s.status === 'enrolled' ? `<button class="btn sm sage" data-fin="${s.id}">Publish final</button>` : '' }], students)}</div>`);
      $('#ag').on('click', () => UI.modal({ title: 'Add grade', submit: 'Save grade', body: UI.field('Student', 'student_id', { type: 'select', options: students.filter((s) => s.status === 'enrolled').map((s) => [s.id, s.full_name]) }) + `<div class="row">${UI.field('Component', 'component', { type: 'select', options: ['quiz', 'assignment', 'midterm', 'final', 'project'].map((x) => [x, x[0].toUpperCase() + x.slice(1)]) })}${UI.field('Title', 'title', { placeholder: 'Quiz 2' })}</div><div class="row">${UI.field('Marks', 'marks', { type: 'number', attrs: 'step="0.5" min="0"' })}${UI.field('Out of', 'max_marks', { type: 'number', value: 100, attrs: 'min="1"' })}${UI.field('Weight (%)', 'weight', { type: 'number', value: 10, attrs: 'min="1" max="100"' })}</div>`,
        onSubmit: async (v) => { const r = await API.post(base + '/grades', v); UI.toast(r.message, 'success'); reload(); } }));
      $t.on('click', '[data-del]', async function () { if (await UI.run(API.del(`${base}/grades/${$(this).data('del')}`))) reload(); })
        .on('click', '[data-fin]', async function () { if (await UI.confirm('Publish the final grade for this student? They will be notified and the course is marked completed.', 'Publish', false) && await UI.run(API.post(base + '/final-grade', { student_id: $(this).data('fin') }))) reload(); });
    }
    if (tab === 'announce') {
      $t.html(`<div class="card"><h3>Announce to your class</h3><form id="af">${UI.field('Title', 'title')}${UI.field('Message', 'message', { type: 'textarea' })}<button class="btn">Send to ${students.length} students</button></form></div>`);
      $('#af').on('submit', async function (e) { e.preventDefault(); if (await UI.run(API.post(base + '/announcements', UI.values($(this))))) this.reset(); });
    }
    if (tab === 'insights') {
      const { students: r } = await API.get(base + '/report'); const flagged = r.filter((x) => x.needs_support);
      $t.html(`<div class="card"><h3>Students who may need support</h3><p class="muted small">These are signals from attendance, missing work and marks. They explain why a student is flagged; they are not predictions.</p>${flagged.map((x) => `<div class="ann"><h4>${UI.esc(x.full_name)}</h4><ul style="margin:.2rem 0;padding-left:1.1rem">${x.reasons.map((y) => `<li>${UI.esc(y)}</li>`).join('')}</ul></div>`).join('') || UI.empty('No concerns right now', 'Everyone is attending and on track.')}</div>
        <div class="card"><h3>Class performance</h3>${UI.table([{ h: 'Student', f: (x) => UI.esc(x.full_name) }, { h: 'Attendance', f: (x) => x.attendance === null ? '-' : x.attendance + '%' }, { h: 'Assignments', f: (x) => `${x.submitted} submitted / ${x.due_assignments} due` }, { h: 'Weighted average', f: (x) => x.avg_pct === null ? '-' : x.avg_pct + '%' }, { h: '', f: (x) => x.needs_support ? UI.badge('check in', 'yellow') : UI.badge('on track', 'green') }], r)}</div>`);
    }
  }
};

$(function () {
  Shell.init({ role: 'faculty', home: 'dashboard', nav: [
    { id: 'dashboard', label: 'Dashboard', render: Faculty.dashboard }, { id: 'courses', label: 'My courses', render: Faculty.courses }, { id: 'course', hidden: true, render: Faculty.course }, { id: 'schedule', label: 'Teaching schedule', render: Faculty.schedule }, { group: 'Campus' },
    { id: 'updates', label: 'Updates', render: Shared.updates }, { id: 'calendar', label: 'Academic calendar', render: Shared.calendar }, { id: 'messages', label: 'Messages', render: Shared.messages }, { id: 'profile', label: 'Profile', render: Shared.profile }] });
});
