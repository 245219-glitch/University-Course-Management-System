// Fills UniversityDB with demo data.
//   npm run db:seed    -> loads demo data. If the demo data is already complete it does nothing;
//                         if it is missing or half-finished it is wiped and reloaded.
//   npm run db:reset   -> always wipes every table and reloads the demo data from scratch.
require('dotenv').config();
const bcrypt = require('bcryptjs'); const db = require('../src/config/db');
const { gradeFromPercentage } = require('../src/utils/grading');

const DEMO_EMAILS = ['coco', 'fahad', 'kamran', 'ghulam', 'mansoor', 'tehreem', 'hania', 'zainab', 'hira',
  'ayesha.khan', 'hamza.ali', 'usman.sheikh', 'maryam.aslam'].map((n) => `${n}@unisphere.edu`);

// Empties every table (keeps the default settings rows).
async function wipeAll() {
  const [tables] = await db.query('SHOW TABLES');
  const conn = await db.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const row of tables) { const t = Object.values(row)[0]; if (t !== 'settings') await conn.query(`TRUNCATE TABLE \`${t}\``); }
  } finally { await conn.query('SET FOREIGN_KEY_CHECKS = 1'); conn.release(); }
}

// Is the full demo data set (all 13 demo accounts, courses and enrolments) in place?
async function demoIsComplete() {
  const [u] = await db.query('SELECT COUNT(*) n FROM users WHERE email IN (?) AND status = "active"', [DEMO_EMAILS]);
  const [c] = await db.query("SELECT COUNT(*) n FROM courses WHERE code IN ('CS-101','CS-201','CS-301L','CS-320','ADV-101')");
  const [e] = await db.query('SELECT COUNT(*) n FROM enrollments');
  return u[0].n === DEMO_EMAILS.length && c[0].n === 5 && e[0].n >= 29;
}

async function seedDemo({ reset = false, log = console.log } = {}) {
  if (!reset && await demoIsComplete()) { log('Demo data already present. Nothing to do.'); return false; }
  const [[{ n: anyUsers }]] = await db.query('SELECT COUNT(*) n FROM users');
  if (anyUsers || reset) { log('Clearing existing data and reloading the demo data...'); await wipeAll(); }
  const h = (p) => bcrypt.hash(p, 10);
  const q = async (sql, p) => (await db.execute(sql, p))[0].insertId;
  const pad = (n) => String(n).padStart(2, '0');

  // ---- departments & semesters ----
  const dept = {};
  for (const [n, c] of [['Computer Science', 'CS'], ['Artificial Intelligence', 'AI'], ['Arts & Humanities', 'ARTS']]) dept[c] = await q('INSERT INTO departments (name, code) VALUES (?,?)', [n, c]);
  const semPrev = await q('INSERT INTO semesters (name, start_date, end_date, registration_open, is_current) VALUES (?,?,?,0,0)', ['Spring 2026', '2026-02-01', '2026-06-15']);
  const sem = await q('INSERT INTO semesters (name, start_date, end_date, registration_open, is_current) VALUES (?,?,?,1,1)', ['Fall 2026', '2026-09-01', '2026-12-20']);

  // ---- admin: Coco ----
  const admin = await q("INSERT INTO users (full_name, email, password_hash, role) VALUES (?,?,?, 'admin')", ['Coco', 'coco@unisphere.edu', await h('Admin@12345')]);

  // ---- teachers ----
  const T = {};
  for (const [key, name, email, d, no] of [['fahad', 'Sir Fahad', 'fahad@unisphere.edu', 'CS', 'T-101'], ['kamran', 'Sir Kamran', 'kamran@unisphere.edu', 'CS', 'T-102'],
    ['ghulam', 'Sir Ghulam', 'ghulam@unisphere.edu', 'CS', 'T-103'], ['mansoor', 'Sir Mansoor', 'mansoor@unisphere.edu', 'CS', 'T-104']])
    T[key] = await q("INSERT INTO users (full_name, email, password_hash, role, department_id, reg_no) VALUES (?,?,?, 'faculty', ?, ?)", [name, email, await h('Faculty@123'), dept[d], no]);

  // ---- students ----
  const S = {};
  const people = [
    ['tehreem', 'Tehreem Malik', 'tehreem@unisphere.edu', 'CS', 'BSCS', 5, '245219'],
    ['hania', 'Hania', 'hania@unisphere.edu', 'AI', 'BSAI', 5, '245231'],
    ['zainab', 'Zainab', 'zainab@unisphere.edu', 'AI', 'BSAI', 5, '245232'],
    ['hira', 'Hira', 'hira@unisphere.edu', 'ARTS', 'BS Arts', 5, '245240'],
    ['ayesha', 'Ayesha Khan', 'ayesha.khan@unisphere.edu', 'CS', 'BSCS', 5, '245221'],
    ['hamza', 'Hamza Ali', 'hamza.ali@unisphere.edu', 'CS', 'BSCS', 5, '245222'],
    ['usman', 'Usman Sheikh', 'usman.sheikh@unisphere.edu', 'CS', 'BSCS', 5, '245223'],
    ['maryam', 'Maryam Aslam', 'maryam.aslam@unisphere.edu', 'AI', 'BSAI', 5, '245233']];
  for (const [k, n, e, d, prog, no, reg] of people)
    S[k] = await q("INSERT INTO users (full_name, email, password_hash, role, department_id, program, semester_no, reg_no) VALUES (?,?,?, 'student', ?,?,?,?)", [n, e, await h('Student@123'), dept[d], prog, no, reg]);

  // ---- courses ----
  const C = {};
  const mk = async (code, title, desc, cr, d, semId, instr, cap, pre = []) => {
    C[code] = await q('INSERT INTO courses (code, title, description, credit_hours, department_id, semester_id, instructor_id, capacity) VALUES (?,?,?,?,?,?,?,?)', [code, title, desc, cr, dept[d], semId, instr, cap]);
    for (const p of pre) await db.execute('INSERT INTO course_prerequisites (course_id, prerequisite_id) VALUES (?,?)', [C[code], C[p]]);
  };
  await mk('CS-101', 'Programming Fundamentals', 'Problem solving and programming basics using JavaScript.', 3, 'CS', semPrev, T.kamran, 60);
  await mk('CS-201', 'Data Structures & Algorithms (DSA)', 'Lists, stacks, queues, trees, graphs, hashing and complexity analysis.', 3, 'CS', sem, T.kamran, 40, ['CS-101']);
  await mk('CS-301L', 'Full Stack Development (FSD)', 'Build secure web apps with jQuery, Node.js, Express and MySQL: authentication, authorization and REST APIs.', 3, 'CS', sem, T.fahad, 40, ['CS-101']);
  await mk('CS-320', 'Design & Analysis of Algorithms (DAA)', 'Divide and conquer, greedy methods, dynamic programming, graph algorithms and NP-completeness.', 3, 'CS', sem, T.mansoor, 40, ['CS-101']);
  await mk('ADV-101', 'Academic Advisory & Mentoring', 'Degree planning, study skills, career guidance and one-to-one mentoring with your advisor.', 1, 'CS', sem, T.ghulam, 4);

  const slots = { 'CS-201': [[1, '08:30', '10:00', 'A-101'], [3, '08:30', '10:00', 'A-101']], 'CS-301L': [[1, '10:00', '11:30', 'Lab-1'], [3, '10:00', '11:30', 'Lab-1']],
    'CS-320': [[2, '10:00', '11:30', 'B-201'], [4, '10:00', '11:30', 'B-201']], 'ADV-101': [[5, '11:30', '12:30', 'A-102']] };
  for (const [code, list] of Object.entries(slots)) for (const [d, s, e, r] of list) await db.execute('INSERT INTO timetables (course_id, day_of_week, start_time, end_time, room) VALUES (?,?,?,?,?)', [C[code], d, s, e, r]);

  // ---- history: everyone finished Programming Fundamentals ----
  const hist = { tehreem: 91, hania: 88, zainab: 84, hira: 72, ayesha: 79, hamza: 66, usman: 58, maryam: 82 };
  for (const [k, p] of Object.entries(hist)) { const g = gradeFromPercentage(p); await db.execute("INSERT INTO enrollments (student_id, course_id, status, grade_letter, grade_points, final_percentage) VALUES (?,?,'completed',?,?,?)", [S[k], C['CS-101'], g.letter, g.points, p]); }

  // ---- current enrolments ----
  const cur = {
    'CS-201': ['tehreem', 'hania', 'zainab', 'hira', 'ayesha', 'hamza', 'usman', 'maryam'],
    'CS-301L': ['tehreem', 'ayesha', 'hamza', 'usman'],
    'CS-320': ['tehreem', 'hania', 'zainab', 'ayesha', 'maryam'],
    'ADV-101': ['tehreem', 'hania', 'zainab', 'hira']                       // capacity 4 -> full
  };
  for (const [code, list] of Object.entries(cur)) for (const k of list) await db.execute('INSERT INTO enrollments (student_id, course_id) VALUES (?,?)', [S[k], C[code]]);
  await db.execute('INSERT INTO waitlists (student_id, course_id) VALUES (?,?)', [S.ayesha, C['ADV-101']]);   // waiting-list demo

  // ---- attendance: 8 class days each ----
  const weak = { usman: 0.5, hamza: 0.7 };   // some students attend less
  for (const [code, list] of Object.entries(cur)) for (const k of list) for (let d = 1; d <= 8; d++) {
    const skip = weak[k] ? (d % Math.round(1 / (1 - weak[k])) === 0) : (k === 'tehreem' && code === 'CS-320' && d === 6);
    await db.execute('INSERT INTO attendance (course_id, student_id, class_date, status) VALUES (?,?,?,?)', [C[code], S[k], `2026-10-${pad(d + 4)}`, skip ? 'absent' : (d === 3 && k === 'hira' ? 'late' : 'present')]);
  }

  // ---- assignments, submissions, grades ----
  const A = {};
  A.dsa1 = await q('INSERT INTO assignments (course_id, title, description, due_date, max_marks) VALUES (?,?,?,?,?)', [C['CS-201'], 'Linked List & Stack Lab', 'Implement a singly linked list and a stack using it. Include reverse().', '2026-10-20 23:59:00', 20]);
  await q('INSERT INTO assignments (course_id, title, description, due_date, max_marks) VALUES (?,?,?,?,?)', [C['CS-201'], 'Binary Search Tree Practice Set', 'Solve the practice set on BST insertion, deletion and traversals.', '2026-12-01 23:59:00', 10]);
  A.fsd1 = await q('INSERT INTO assignments (course_id, title, description, due_date, max_marks) VALUES (?,?,?,?,?)', [C['CS-301L'], 'Lab 1: Auth with bcrypt + JWT', 'Build register/login with bcrypt, issue JWTs and protect routes with middleware.', '2026-10-25 23:59:00', 50]);
  await q('INSERT INTO assignments (course_id, title, description, due_date, max_marks) VALUES (?,?,?,?,?)', [C['CS-301L'], 'Lab 2: Role-Based Dashboards', 'Student and admin dashboards, course CRUD and 403 for students on admin APIs.', '2026-12-05 23:59:00', 50]);
  A.daa1 = await q('INSERT INTO assignments (course_id, title, description, due_date, max_marks) VALUES (?,?,?,?,?)', [C['CS-320'], 'Assignment 1: Recurrences & Sorting', 'Solve recurrences with the Master theorem and compare merge sort with quick sort.', '2026-10-22 23:59:00', 25]);
  await q('INSERT INTO assignments (course_id, title, description, due_date, max_marks) VALUES (?,?,?,?,?)', [C['CS-320'], 'Assignment 2: Greedy & DP', 'Activity selection, knapsack and longest common subsequence.', '2026-12-08 23:59:00', 25]);
  await q('INSERT INTO assignments (course_id, title, description, due_date, max_marks) VALUES (?,?,?,?,?)', [C['ADV-101'], 'Degree Plan Reflection', 'Write one page on your goals for the remaining semesters.', '2026-12-10 23:59:00', 10]);

  const sub = async (aid, k, status, marks, fb, text) => db.execute('INSERT INTO submissions (assignment_id, student_id, text_answer, status, marks, feedback) VALUES (?,?,?,?,?,?)', [aid, S[k], text || 'See my repository link in the file.', status, marks, fb]);
  await sub(A.dsa1, 'tehreem', 'graded', 18, 'Clean code. Handle the empty-list case in reverse().');
  await sub(A.dsa1, 'hania', 'graded', 17, 'Good work.');
  await sub(A.dsa1, 'zainab', 'submitted', null, null);
  await sub(A.dsa1, 'hamza', 'late', null, null);
  await sub(A.fsd1, 'tehreem', 'graded', 46, 'Excellent JWT middleware. Add rate limiting next time.');
  await sub(A.fsd1, 'ayesha', 'submitted', null, null);
  await sub(A.daa1, 'tehreem', 'graded', 22, 'Correct recurrences. Show the recursion tree for T(n)=2T(n/2)+n.');
  await sub(A.daa1, 'hania', 'submitted', null, null);

  const scores = { tehreem: [18, 44], hania: [17, 41], zainab: [15, 36], hira: [13, 30], ayesha: [14, 33], hamza: [10, 24], usman: [7, 18], maryam: [16, 39] };
  for (const [k, [qz, mid]] of Object.entries(scores)) {
    await db.execute("INSERT INTO grades (course_id, student_id, component, title, marks, max_marks, weight) VALUES (?,?,'quiz','Quiz 1',?,20,10)", [C['CS-201'], S[k], qz]);
    await db.execute("INSERT INTO grades (course_id, student_id, component, title, marks, max_marks, weight) VALUES (?,?,'midterm','Midterm',?,50,30)", [C['CS-201'], S[k], mid]);
  }
  for (const [k, m] of [['tehreem', 46], ['ayesha', 38], ['hamza', 31], ['usman', 22]])
    await db.execute("INSERT INTO grades (course_id, student_id, component, title, marks, max_marks, weight) VALUES (?,?,'assignment','Lab 1',?,50,15)", [C['CS-301L'], S[k], m]);
  for (const [k, m] of [['tehreem', 22], ['hania', 20], ['zainab', 18], ['ayesha', 17], ['maryam', 21]])
    await db.execute("INSERT INTO grades (course_id, student_id, component, title, marks, max_marks, weight) VALUES (?,?,'assignment','Assignment 1',?,25,15)", [C['CS-320'], S[k], m]);

  // ---- course materials (small text files so downloads work) ----
  const fs = require('fs'); const path = require('path');
  const dir = path.join(__dirname, '..', 'uploads', 'materials'); fs.mkdirSync(dir, { recursive: true });
  const mat = [['CS-301L', T.fahad, 'Week 1 - Express & REST basics', 'fsd-week1.txt', 'Full Stack Development - Week 1\n\n- HTTP, REST and JSON\n- Express routing and middleware\n- Connecting MySQL with mysql2 (parameterised queries only!)\n'],
    ['CS-301L', T.fahad, 'Authentication & JWT guide', 'fsd-auth.txt', 'Authentication checklist\n\n1. Validate input on the backend\n2. Hash with bcrypt\n3. Sign a JWT with an expiry\n4. Verify on every protected route\n5. Check the role (RBAC)\n'],
    ['CS-201', T.kamran, 'Week 1 - Big-O cheat sheet', 'dsa-bigO.txt', 'Big-O cheat sheet\n\nO(1) < O(log n) < O(n) < O(n log n) < O(n^2) < O(2^n)\n'],
    ['CS-320', T.mansoor, 'Master theorem summary', 'daa-master.txt', 'Master theorem: T(n)=aT(n/b)+f(n)\nCompare f(n) with n^(log_b a) to pick the case.\n'],
    ['ADV-101', T.ghulam, 'Degree planning worksheet', 'adv-plan.txt', 'Degree planning worksheet\n\nList remaining courses, credit hours and target semesters.\n']];
  for (const [code, uid, title, file, text] of mat) {
    const stored = 'seed-' + file; fs.writeFileSync(path.join(dir, stored), text);
    await db.execute('INSERT INTO materials (course_id, title, file_path, file_name, uploaded_by) VALUES (?,?,?,?,?)', [C[code], title, stored, file, uid]);
  }

  // ---- announcements, calendar, notifications, tickets, messages ----
  await q("INSERT INTO announcements (title, message, author_id, audience) VALUES (?,?,?, 'all')", ['Welcome to Fall 2026', 'Course registration is open until the end of week two. Check prerequisites before you enrol.', admin]);
  await q("INSERT INTO announcements (title, message, author_id, course_id, audience) VALUES (?,?,?,?, 'students')", ['Lab 1 is live', 'Bring your laptops. XAMPP and Node.js must be installed before the first lab.', T.fahad, C['CS-301L']]);
  await q("INSERT INTO announcements (title, message, author_id, course_id, audience) VALUES (?,?,?,?, 'students')", ['Quiz 2 next week', 'Quiz 2 covers stacks, queues and linked lists.', T.kamran, C['CS-201']]);
  await q("INSERT INTO announcements (title, message, author_id, course_id, audience) VALUES (?,?,?,?, 'students')", ['Advisory slots open', 'Book a 15-minute slot with me during office hours this week.', T.ghulam, C['ADV-101']]);
  for (const [t, d, ty] of [['Last day to add/drop courses', '2026-09-15', 'deadline'], ['Midterm examinations begin', '2026-10-26', 'exam'], ['Final examinations begin', '2026-12-14', 'exam'], ['Winter break', '2026-12-21', 'holiday']])
    await db.execute('INSERT INTO calendar_events (title, event_date, type, created_by) VALUES (?,?,?,?)', [t, d, ty, admin]);
  await db.execute('INSERT INTO notifications (user_id, title, message, type) VALUES (?,?,?,?)', [S.tehreem, 'Welcome to UniSphere', 'Your dashboard is ready. Explore courses and build your timetable.', 'success']);
  await db.execute('INSERT INTO notifications (user_id, title, message, type) VALUES (?,?,?,?)', [S.tehreem, 'Assignment graded', 'CS-301L: "Lab 1: Auth with bcrypt + JWT" scored 46/50.', 'success']);
  await db.execute('INSERT INTO notifications (user_id, title, message, type) VALUES (?,?,?,?)', [S.usman, 'Low attendance warning', 'Your attendance in CS-201 is 50% (minimum 75%).', 'warning']);
  await db.execute('INSERT INTO support_tickets (student_id, category, subject, message) VALUES (?,?,?,?)', [S.hira, 'registration', 'Cannot see FSD in my catalogue', 'I am in BS Arts and would like to take Full Stack Development as an elective. Is that possible?']);
  await db.execute('INSERT INTO messages (sender_id, recipient_id, subject, body) VALUES (?,?,?,?)', [T.fahad, S.tehreem, 'Lab 1 feedback', 'Great job on the JWT middleware. Please add rate limiting to the login route for Lab 2.']);

  log(`Seed complete.
  Admin:    coco@unisphere.edu / Admin@12345
  Teachers: fahad@ (Full Stack Dev), kamran@ (DSA), ghulam@ (Advisory), mansoor@ (DAA) @unisphere.edu / Faculty@123
  Students: tehreem@ (BSCS), hania@ & zainab@ (BSAI), hira@ (BS Arts) @unisphere.edu / Student@123`);
  return true;
}

module.exports = { seedDemo, wipeAll, demoIsComplete };

if (require.main === module) {
  seedDemo({ reset: process.argv.includes('--reset') })
    .then(() => db.end())
    .catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
}
