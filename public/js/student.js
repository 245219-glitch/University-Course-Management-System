/* Student portal */
const courseCard = (c, onAction) => {
  const full = c.seats_left === 0, pct = Math.round((c.enrolled_count / c.capacity) * 100);
  let btn;
  if (c.my_status === 'enrolled') btn = '<span class="badge green">Enrolled</span>';
  else if (c.my_status === 'completed') btn = '<span class="badge blue">Completed</span>';
  else if (c.my_status === 'waitlisted') btn = '<span class="badge yellow">On waiting list</span>';
  else if (c.status !== 'open' || c.registration_open === 0) btn = '<span class="badge red">Closed</span>';
  else btn = `<button class="btn sm ${full ? 'soft' : ''}" data-enrol="${c.id}">${full ? 'Join waiting list' : 'Enrol'}</button>`;
  return `<article class="course"><div class="code">${UI.esc(c.code)} · ${c.credit_hours} credit hours</div><h3 data-detail="${c.id}">${UI.esc(c.title)}</h3>
    <div class="meta"><span>${UI.esc(c.instructor_name || 'Instructor to be announced')}</span><span>${UI.esc(c.department_name || '')}</span></div>
    <div class="meta">${c.slots.map((s) => `<span>${DAYS[s.day_of_week].slice(0, 3)} ${UI.time(s.start_time)}</span>`).join('') || '<span>Schedule to be announced</span>'}</div>
    ${c.prerequisites.length ? `<div class="small muted">Requires ${c.prerequisites.map((p) => UI.esc(p.code)).join(', ')}</div>` : ''}
    <div>${UI.bar(pct, null)}<div class="small muted" style="margin-top:.2rem">${full ? 'Full' : c.seats_left + ' of ' + c.capacity + ' seats left'}${c.waitlist_count ? ` · ${c.waitlist_count} waiting` : ''}</div></div>
    <div class="foot"><a href="#" class="small" data-detail="${c.id}">Details</a>${btn}</div></article>`;
};

async function enrolAction(id, refresh) {
  try {
    const r = await API.post('/api/enrollments', { course_id: +id });
    UI.toast(r.message, r.waitlisted ? 'warning' : 'success'); Shell.poll(); refresh();
  } catch (e) { UI.toast(e.message, 'error'); }
}
function bindCourseActions($v, refresh) {
  $v.off('click.c').on('click.c', '[data-enrol]', (e) => enrolAction($(e.currentTarget).data('enrol'), refresh))
    .on('click.c', '[data-detail]', async (e) => {
      e.preventDefault(); const { course: c } = await API.get('/api/courses/' + $(e.currentTarget).data('detail'));
      UI.modal({ title: `${UI.esc(c.code)} · ${UI.esc(c.title)}`, wide: true, body: `<p>${UI.esc(c.description || 'No description yet.')}</p>
        <div class="row"><div><b>Instructor</b><br>${UI.esc(c.instructor_name || 'TBA')}<br><span class="muted small">${UI.esc(c.instructor_email || '')}</span></div><div><b>Department</b><br>${UI.esc(c.department_name || '-')}</div><div><b>Semester</b><br>${UI.esc(c.semester_name || '-')}</div><div><b>Credit hours</b><br>${c.credit_hours}</div><div><b>Seats</b><br>${c.seats_left} of ${c.capacity} left</div></div>
        <h4 style="margin-top:1rem">Weekly schedule</h4>${c.slots.map((s) => `<div>${DAYS[s.day_of_week]} ${UI.time(s.start_time)}-${UI.time(s.end_time)} ${s.room ? '· ' + UI.esc(s.room) : ''}</div>`).join('') || '<span class="muted">Not scheduled yet</span>'}
        <h4 style="margin-top:1rem">Prerequisites</h4>${c.prerequisites.map((p) => `<div>${UI.esc(p.code)} - ${UI.esc(p.title)}</div>`).join('') || '<span class="muted">None</span>'}` });
    });
}

const Student = {
  async dashboard($v) {
    const [d, rec, ann] = await Promise.all([API.get('/api/student/dashboard'), API.get('/api/student/recommendations'), API.get('/api/announcements')]);
    const s = d.stats, hr = new Date().getHours(), greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    const day = new Date().getDay() || 7, mins = new Date().getHours() * 60 + new Date().getMinutes(); const toM = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
    const upcoming = [...d.timetable].sort((a, b) => ((a.day_of_week - day + 7) % 7) * 1440 + toM(a.start_time) - (((b.day_of_week - day + 7) % 7) * 1440 + toM(b.start_time))).slice(0, 4);
    $v.html(`<div class="hero-banner"><div><h1>${greet}, ${UI.esc(d.profile.full_name.split(' ')[0])}</h1><div>${UI.esc(d.profile.program || '')}${d.profile.semester_no ? ' · Semester ' + d.profile.semester_no + ' · ' : ' · '}${UI.esc(d.profile.department_name || 'Department not set')}</div><div class="small">${UI.esc(d.profile.email)} · Reg. ${UI.esc(d.profile.reg_no || '-')}</div></div>
      <div><b>${d.semester ? UI.esc(d.semester.name) : 'No active semester'}</b>${d.semester ? `<div class="small">${UI.date(d.semester.start_date)} to ${UI.date(d.semester.end_date)}</div>` : ''}</div></div>
      <div class="stats"><div class="stat"><b>${s.enrolled_courses}</b><span>Enrolled courses</span></div><div class="stat"><b>${s.current_credits}</b><span>Credit hours now</span></div><div class="stat"><b>${s.completed_credits ? s.cgpa.toFixed(2) : '-'}</b><span>CGPA (${s.completed_credits} credits done)</span></div>
      <div class="stat"><b>${s.pending_assignments}</b><span>Pending assignments</span></div><div class="stat"><b>${s.attendance === null ? '-' : s.attendance + '%'}</b><span>Attendance</span></div></div>
      <div class="grid g2"><div class="card"><h3>Coming up in class</h3>${upcoming.map((t) => `<div class="list-item"><div><b>${UI.esc(t.code)} ${UI.esc(t.title)}</b><div class="muted small">${UI.esc(t.instructor_name || '')} ${t.room ? '· ' + UI.esc(t.room) : ''}</div></div><div class="right"><b>${DAYS[t.day_of_week].slice(0, 3)}</b><div class="small">${UI.time(t.start_time)}</div></div></div>`).join('') || UI.empty('No classes yet', 'Enrol in a course to build your timetable.')}</div>
      <div class="card"><h3>Due soon</h3>${d.pending_assignments.map((a) => `<div class="list-item"><div><b>${UI.esc(a.title)}</b><div class="muted small">${UI.esc(a.code)} · ${a.max_marks} marks</div></div><span class="small">${UI.dt(a.due_date)}</span></div>`).join('') || UI.empty('You are all caught up', 'No assignments are waiting.')}</div></div>
      <div class="grid g2"><div class="card"><h3>Attendance by course</h3>${d.attendance.courses.map((c) => `<div style="margin-bottom:.8rem"><div class="list-item" style="border:0;padding:0"><span>${UI.esc(c.code)} ${UI.esc(c.title)}</span><b>${c.percentage === null ? 'No classes yet' : c.percentage + '%'}</b></div>${c.percentage === null ? '' : UI.bar(c.percentage, d.attendance.threshold)}</div>`).join('') || UI.empty('No enrolled courses')}<div class="small muted">The dark mark shows the ${d.attendance.threshold}% minimum.</div></div>
      <div class="card"><h3>Recommended for you</h3>${rec.recommendations.slice(0, 3).map((r) => `<div class="list-item"><div><b>${UI.esc(r.code)} ${UI.esc(r.title)}</b><div class="muted small">${UI.esc(r.reasons.join(' · '))}</div></div><button class="btn sm" data-enrol="${r.id}">Enrol</button></div>`).join('') || UI.empty('Nothing new to suggest', 'You are in every open course that fits your timetable and prerequisites.')}<a href="#foryou" class="small">See all suggestions</a></div></div>
      <div class="card"><h3>Latest announcements</h3>${ann.announcements.slice(0, 3).map((x) => `<div class="ann"><h4>${UI.esc(x.title)}</h4><p style="margin:0">${UI.esc(x.message)}</p></div>`).join('') || UI.empty('No announcements')}</div>`);
    bindCourseActions($v, () => Student.dashboard($v));
  },

  async catalog($v) {
    const lk = await API.get('/api/courses/meta/lookups');
    $v.html(`<h1>Course catalogue</h1><div class="toolbar"><input type="search" id="q" placeholder="Search by course name or code" aria-label="Search courses">
      <select id="dep"><option value="">All departments</option>${lk.departments.map((d) => `<option value="${d.id}">${UI.esc(d.name)}</option>`).join('')}</select>
      <select id="sem"><option value="">All semesters</option>${lk.semesters.map((s) => `<option value="${s.id}">${UI.esc(s.name)}</option>`).join('')}</select></div><div id="list">${UI.loading()}</div>`);
    const load = async () => {
      const { courses } = await API.get('/api/courses', { search: $('#q').val(), department_id: $('#dep').val(), semester_id: $('#sem').val() });
      $('#list').html(courses.length ? `<div class="grid g3">${courses.map((c) => courseCard(c)).join('')}</div>` : UI.empty('No courses match your search', 'Try a different name, code or department.'));
    };
    let t; $('#q').on('input', () => { clearTimeout(t); t = setTimeout(load, 250); }); $('#dep,#sem').on('change', load);
    bindCourseActions($v, load); load();
  },

  async mycourses($v) {
    const d = await API.get('/api/enrollments/me');
    const cur = d.enrollments.filter((e) => e.status === 'enrolled');
    $v.html(`<h1>My courses</h1><div class="card"><h3>Current enrolments</h3>${UI.table([
      { h: 'Course', f: (e) => `<b>${UI.esc(e.code)}</b> ${UI.esc(e.title)}` }, { h: 'Instructor', f: (e) => UI.esc(e.instructor_name || '-') }, { h: 'Credits', f: (e) => e.credit_hours }, { h: 'Semester', f: (e) => UI.esc(e.semester_name || '-') },
      { h: '', cls: 'right', f: (e) => `<button class="btn sm danger" data-wd="${e.course_id}" data-code="${UI.esc(e.code)}">Withdraw</button>` }], cur, 'You are not enrolled in any course yet. Browse the catalogue to get started.')}</div>
      ${d.waitlist.length ? `<div class="card"><h3>Waiting list</h3>${UI.table([{ h: 'Course', f: (w) => `<b>${UI.esc(w.code)}</b> ${UI.esc(w.title)}` }, { h: 'Your position', f: (w) => UI.badge('#' + w.position, 'yellow') }, { h: 'Since', f: (w) => UI.date(w.created_at) }, { h: '', cls: 'right', f: (w) => `<button class="btn sm ghost" data-leave="${w.course_id}">Leave list</button>` }], d.waitlist)}<p class="small muted">If a seat opens you are enrolled automatically and notified.</p></div>` : ''}
      <div class="card"><h3>Enrolment history</h3>${UI.table([{ h: 'Course', f: (e) => `${UI.esc(e.code)} ${UI.esc(e.title)}` }, { h: 'Status', f: (e) => UI.badge(e.status, UI.tone(e.status)) }, { h: 'Grade', f: (e) => e.grade_letter ? `<b>${e.grade_letter}</b> (${e.final_percentage}%)` : '-' }, { h: 'Date', f: (e) => UI.date(e.enrolled_at) }], d.enrollments)}</div>`);
    $v.off('click.w').on('click.w', '[data-wd]', async function () {
      if (!await UI.confirm(`Withdraw from ${$(this).data('code')}? Your seat will be offered to the next student on the waiting list.`, 'Withdraw')) return;
      if (await UI.run(API.del('/api/enrollments/' + $(this).data('wd')))) Student.mycourses($v);
    }).on('click.w', '[data-leave]', async function () { if (await UI.run(API.del('/api/enrollments/waitlist/' + $(this).data('leave')))) Student.mycourses($v); });
  },

  async timetable($v) {
    const { timetable: t } = await API.get('/api/student/timetable');
    $v.html(`<div class="card-head"><h1>Weekly timetable</h1><button class="btn soft" id="ics">Add to my calendar (.ics)</button></div><div class="card">${t.length ? `<div class="tt">${[1, 2, 3, 4, 5, 6].map((d) => `<div><h4>${DAYS[d]}</h4>${t.filter((x) => x.day_of_week === d).map((x) => `<div class="slot"><b>${UI.esc(x.code)}</b>${UI.time(x.start_time)}-${UI.time(x.end_time)}<br>${UI.esc(x.room || 'Room TBA')}<br><span class="muted">${UI.esc(x.instructor_name || '')}</span></div>`).join('') || '<div class="muted small">Free</div>'}</div>`).join('')}</div>` : UI.empty('Your timetable is empty', 'Enrol in courses and your classes will appear here.')}</div>`);
    $('#ics').on('click', () => {
      if (!t.length) return UI.toast('Nothing to export yet.', 'warning');
      const code = ['', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']; const now = new Date(); const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      const ev = t.map((x, i) => { const d = new Date(monday); d.setDate(monday.getDate() + x.day_of_week - 1); const ds = d.toISOString().slice(0, 10).replace(/-/g, '');
        return `BEGIN:VEVENT\r\nUID:unisphere-${i}-${ds}@unisphere\r\nDTSTAMP:${ds}T000000Z\r\nDTSTART:${ds}T${x.start_time.slice(0, 2)}${x.start_time.slice(3, 5)}00\r\nDTEND:${ds}T${x.end_time.slice(0, 2)}${x.end_time.slice(3, 5)}00\r\nRRULE:FREQ=WEEKLY;COUNT=16;BYDAY=${code[x.day_of_week]}\r\nSUMMARY:${x.code} ${x.title}\r\nLOCATION:${x.room || ''}\r\nEND:VEVENT`; }).join('\r\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//UniSphere//EN\r\n${ev}\r\nEND:VCALENDAR`], { type: 'text/calendar' })); a.download = 'unisphere-timetable.ics'; a.click();
    });
  },

  async assignments($v) {
    const { assignments: list } = await API.get('/api/student/assignments');
    $v.html(`<h1>Assignments</h1><div class="card">${UI.table([
      { h: 'Assignment', f: (a) => `<b>${UI.esc(a.title)}</b><div class="muted small">${UI.esc(a.code)} ${UI.esc(a.course_title)}</div>` }, { h: 'Due', f: (a) => UI.dt(a.due_date) },
      { h: 'Status', f: (a) => UI.badge(a.status, UI.tone(a.status)) }, { h: 'Marks', f: (a) => a.marks !== null && a.marks !== undefined ? `<b>${a.marks}</b> / ${a.max_marks}` : `- / ${a.max_marks}` },
      { h: '', cls: 'right', f: (a) => `<div class="actions">${a.submission_id && a.file_name ? `<button class="btn sm ghost" data-file="${a.submission_id}" data-name="${UI.esc(a.file_name)}">My file</button>` : ''}${a.feedback ? `<button class="btn sm ghost" data-fb="${a.id}">Feedback</button>` : ''}${a.status !== 'graded' ? `<button class="btn sm" data-sub="${a.id}">${a.submission_id ? 'Resubmit' : 'Submit'}</button>` : ''}</div>` }], list, 'No assignments yet. They will appear here when your instructors publish them.')}</div>`);
    $v.off('click.a').on('click.a', '[data-fb]', function () { const a = list.find((x) => x.id === +$(this).data('fb')); UI.modal({ title: 'Instructor feedback', body: `<p>${UI.esc(a.feedback)}</p>` }); })
      .on('click.a', '[data-file]', function () { UI.download('/api/files/submissions/' + $(this).data('file'), $(this).data('name')); })
      .on('click.a', '[data-sub]', function () {
        const a = list.find((x) => x.id === +$(this).data('sub'));
        UI.modal({ title: `Submit: ${UI.esc(a.title)}`, submit: 'Submit assignment', body: `<p class="muted small">Due ${UI.dt(a.due_date)}. ${a.status === 'overdue' ? 'This is past the deadline and will be marked late.' : ''}</p>${UI.field('Your answer (optional if you attach a file)', 'text_answer', { type: 'textarea', req: false })}
          <div class="field"><label>Attach a file (PDF, Word, ZIP, image - max 10 MB)</label><input type="file" name="file"></div>`,
          onSubmit: async (v, $m) => { const fd = new FormData($m.find('form')[0]); const r = await API.upload(`/api/student/assignments/${a.id}/submit`, fd); UI.toast(r.message, r.status === 'late' ? 'warning' : 'success'); Student.assignments($v); } });
      });
  },

  async materials($v) {
    const { materials: m } = await API.get('/api/student/materials'); const by = {}; m.forEach((x) => (by[x.code + ' ' + x.course_title] = by[x.code + ' ' + x.course_title] || []).push(x));
    $v.html(`<h1>Learning materials</h1>${Object.keys(by).map((k) => `<div class="card"><h3>${UI.esc(k)}</h3>${by[k].map((x) => `<div class="list-item"><div><b>${UI.esc(x.title)}</b><div class="muted small">${UI.esc(x.file_name)} · ${UI.date(x.uploaded_at)}</div></div><button class="btn sm soft" data-dl="${x.id}" data-name="${UI.esc(x.file_name)}">Download</button></div>`).join('')}</div>`).join('') || `<div class="card">${UI.empty('No materials yet', 'Lecture notes and slides from your instructors will show up here.')}</div>`}`);
    $v.off('click.m').on('click.m', '[data-dl]', function () { UI.download('/api/files/materials/' + $(this).data('dl'), $(this).data('name')); });
  },

  async attendance($v) {
    const a = await API.get('/api/student/attendance');
    $v.html(`<h1>Attendance</h1><div class="stats"><div class="stat"><b>${a.overall === null ? '-' : a.overall + '%'}</b><span>Overall attendance</span></div><div class="stat"><b>${a.threshold}%</b><span>Required minimum</span></div></div>
      <div class="card">${a.courses.map((c) => `<div style="margin-bottom:1.1rem"><div class="list-item" style="border:0;padding:0 0 .3rem"><b>${UI.esc(c.code)} ${UI.esc(c.title)}</b><span>${c.total ? `${c.attended} of ${c.total} classes · <b>${c.percentage}%</b>` : 'No classes recorded'} ${c.below_threshold ? UI.badge('Below minimum', 'red') : ''}</span></div>${c.total ? UI.bar(c.percentage, a.threshold) : ''}</div>`).join('') || UI.empty('No enrolled courses')}</div>`);
  },

  async grades($v) {
    const g = await API.get('/api/student/grades');
    $v.html(`<h1>Grades & progress</h1><div class="stats"><div class="stat"><b>${g.completed_credits ? g.cgpa.toFixed(2) : '-'}</b><span>Cumulative GPA</span></div><div class="stat"><b>${g.completed_credits}</b><span>Completed credit hours</span></div></div>
      ${g.semesters.length ? `<div class="card"><h3>GPA by semester</h3><canvas id="gc" height="90"></canvas></div>` : ''}
      ${g.courses.map((c) => `<div class="card"><div class="card-head"><h3>${UI.esc(c.code)} ${UI.esc(c.title)}</h3><div>${c.status === 'completed' ? `${UI.badge(c.grade_letter + ' · ' + c.final_percentage + '%', 'green')}` : `${UI.badge('In progress', 'yellow')} ${c.percentage_so_far !== null ? `<b>${c.percentage_so_far}%</b> so far` : ''}`}</div></div>
        ${c.components.length ? UI.table([{ h: 'Component', f: (x) => `${UI.esc(x.title)} ${UI.badge(x.component, 'peach')}` }, { h: 'Marks', f: (x) => `${x.marks} / ${x.max_marks}` }, { h: 'Weight', f: (x) => x.weight + '%' }], c.components) : '<span class="muted small">No marks recorded yet.</span>'}</div>`).join('') || `<div class="card">${UI.empty('No grades yet')}</div>`}`);
    if (g.semesters.length) UI.chart($('#gc')[0], { type: 'bar', data: { labels: g.semesters.map((s) => s.semester), datasets: [{ label: 'GPA', data: g.semesters.map((s) => s.gpa), backgroundColor: '#E9BE62', borderRadius: 8 }] }, options: { scales: { y: { min: 0, max: 4 } }, plugins: { legend: { display: false } } } });
  },

  async foryou($v) {
    const { recommendations: r } = await API.get('/api/student/recommendations');
    $v.html(`<h1>Recommended for you</h1><p class="muted">Open courses you can actually take: prerequisites done, no timetable clash, and within your credit limit.</p>${r.length ? `<div class="grid g3">${r.map((c) => `<article class="course"><div class="code">${UI.esc(c.code)} · ${c.credit_hours} credit hours</div><h3>${UI.esc(c.title)}</h3><div class="meta"><span>${UI.esc(c.instructor_name || 'TBA')}</span><span>${c.seats_left} seats left</span></div><ul class="small" style="margin:.2rem 0;padding-left:1.1rem">${c.reasons.map((x) => `<li>${UI.esc(x)}</li>`).join('')}</ul><div class="foot"><span></span><button class="btn sm" data-enrol="${c.id}">Enrol</button></div></article>`).join('')}</div>` : `<div class="card">${UI.empty('Nothing new to suggest', 'You are in every open course that fits your timetable, prerequisites and credit limit.')}</div>`}`);
    bindCourseActions($v, () => Student.foryou($v));
  },

  async support($v) {
    const { tickets: t } = await API.get('/api/student/tickets');
    $v.html(`<div class="card-head"><h1>Help desk</h1><button class="btn" id="nt">New ticket</button></div>${t.map((x) => `<div class="card"><div class="card-head"><h3>${UI.esc(x.subject)}</h3><div>${UI.badge(x.category, 'peach')} ${UI.badge(x.status.replace('_', ' '), UI.tone(x.status))}</div></div><p>${UI.esc(x.message)}</p>${x.response ? `<div class="ann"><b>Reply</b><p style="margin:.2rem 0 0">${UI.esc(x.response)}</p></div>` : ''}<span class="muted small">Opened ${UI.dt(x.created_at)}</span></div>`).join('') || `<div class="card">${UI.empty('No tickets yet', 'Having trouble with registration, your timetable or your account? Open a ticket.')}</div>`}`);
    $('#nt').on('click', () => UI.modal({ title: 'New support ticket', submit: 'Send ticket', body: UI.field('Category', 'category', { type: 'select', options: [['registration', 'Course registration'], ['timetable', 'Timetable'], ['account', 'Account'], ['academic', 'Academic question'], ['other', 'Something else']] }) + UI.field('Subject', 'subject') + UI.field('What happened?', 'message', { type: 'textarea' }),
      onSubmit: async (v) => { const r = await API.post('/api/student/tickets', v); UI.toast(r.message, 'success'); Student.support($v); } }));
  }
};

function assistant() {
  $('body').append(`<button class="fab" id="fab">Ask UniSphere</button><div class="chat hidden" id="chat"><header>UniSphere assistant</header><div class="msgs" id="msgs"><div class="msg bot">Hi! I can answer questions about your courses, classes, assignments, attendance and GPA.</div></div>
    <div class="sugg">${['Which courses can I enrol in?', 'When is my next class?', 'What is due this week?', 'How is my attendance?'].map((q) => `<button class="btn sm soft sq">${q}</button>`).join('')}</div>
    <form id="cf"><input type="text" id="ci" placeholder="Type a question" maxlength="300" aria-label="Question"><button class="btn sm">Ask</button></form></div>`);
  $('#fab').on('click', () => $('#chat').toggleClass('hidden'));
  const ask = async (q) => {
    $('#msgs').append($('<div class="msg me"></div>').text(q)); const $w = $('<div class="msg bot">Thinking…</div>').appendTo('#msgs');
    try { $w.text((await API.post('/api/student/assistant', { question: q })).answer); } catch (e) { $w.text(e.message); }
    $('#msgs').scrollTop(1e6);
  };
  $('#cf').on('submit', (e) => { e.preventDefault(); const q = $('#ci').val().trim(); if (q) { $('#ci').val(''); ask(q); } });
  $('.sq').on('click', function () { ask($(this).text()); });
}

$(async function () {
  await Shell.init({ role: 'student', home: 'dashboard', nav: [
    { id: 'dashboard', label: 'Dashboard', render: Student.dashboard }, { group: 'Courses' },
    { id: 'catalog', label: 'Course catalogue', render: Student.catalog }, { id: 'mycourses', label: 'My courses', render: Student.mycourses }, { id: 'foryou', label: 'Recommended', render: Student.foryou }, { id: 'timetable', label: 'Timetable', render: Student.timetable }, { group: 'Learning' },
    { id: 'assignments', label: 'Assignments', render: Student.assignments }, { id: 'materials', label: 'Materials', render: Student.materials }, { id: 'attendance', label: 'Attendance', render: Student.attendance }, { id: 'grades', label: 'Grades & GPA', render: Student.grades }, { group: 'Campus' },
    { id: 'updates', label: 'Updates', render: Shared.updates }, { id: 'calendar', label: 'Academic calendar', render: Shared.calendar }, { id: 'messages', label: 'Messages', render: Shared.messages }, { id: 'support', label: 'Help desk', render: Student.support }, { id: 'profile', label: 'Profile & ID', render: Shared.profile }] });
  assistant();
});
