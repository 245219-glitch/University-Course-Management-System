# UniSphere - Smart University Management & Learning Platform
*One campus. One platform. Endless possibilities.*

A web-based University Course Management System with student, faculty and administrator portals.
**Stack:** HTML/CSS, JavaScript + jQuery (AJAX) · Node.js + Express · MySQL (XAMPP) · bcrypt · JWT · role-based access control.

## 1. Run it (XAMPP, Windows/Mac/Linux)
1. Install **Node.js 18+** and **XAMPP**. In the XAMPP control panel, **start MySQL**.
2. Open a terminal in this folder and run:
   ```bash
   npm install
   npm start            # http://localhost:3000
   ```
   `npm start` now creates the `UniversityDB` database, all tables and the full demo data by itself the first time (and repairs a half-filled database). You no longer need to run anything else.

   **If login says "Invalid email or password"** the database is missing or has incomplete demo data. Run `npm run db:reset` (wipes everything and reloads the demo data), then `npm start`.
   Other commands: `npm run db:setup` (tables only) · `npm run db:seed` (load demo data if missing) · `npm run db:reset` (always start from clean demo data).
   (Alternative to `db:setup`: import `database/UniversityDB.sql` in phpMyAdmin.)
3. Open **http://localhost:3000**.

`.env` already holds XAMPP defaults (user `root`, empty password, database `UniversityDB`). If your MySQL has a password, edit `.env`. **Change `JWT_SECRET` before any real deployment.**

### Demo accounts (created by `npm run db:seed`)
The login page has **three tabs: Student, Teacher and Admin**. Each tab only accepts its own kind of account (a student cannot log in through the Admin tab). Only students can self-register; teacher and admin accounts are created by the admin.

| Role | Name | Email | Password |
|---|---|---|---|
| Admin | Coco | coco@unisphere.edu | Admin@12345 |
| Teacher | Sir Fahad (Full Stack Development) | fahad@unisphere.edu | Faculty@123 |
| Teacher | Sir Kamran (DSA) | kamran@unisphere.edu | Faculty@123 |
| Teacher | Sir Ghulam (Advisory) | ghulam@unisphere.edu | Faculty@123 |
| Teacher | Sir Mansoor (DAA) | mansoor@unisphere.edu | Faculty@123 |
| Student | Tehreem Malik (BSCS, sem 5) | tehreem@unisphere.edu | Student@123 |
| Student | Hania (BSAI, sem 5) | hania@unisphere.edu | Student@123 |
| Student | Zainab (BSAI, sem 5) | zainab@unisphere.edu | Student@123 |
| Student | Hira (BS Arts, sem 5) | hira@unisphere.edu | Student@123 |

Four more BSCS/BSAI students (Ayesha, Hamza, Usman, Maryam) fill the classes. Sample courses: CS-201 DSA (Sir Kamran), CS-301L Full Stack Development (Sir Fahad), CS-320 DAA (Sir Mansoor), ADV-101 Academic Advisory (Sir Ghulam, only 4 seats so you can see the waiting list). The demo data includes attendance, assignments, submissions, grades, materials, announcements, a help-desk ticket and a message.

Create your own administrator: `npm run create-admin -- "Your Name" you@uni.edu YourPass123`

## 2. Lab requirements -> where they live
| # | Requirement | Implementation |
|---|---|---|
| 1 | Database `UniversityDB` with users + courses | `database/UniversityDB.sql` (20 tables) |
| 2 | Registration UI (name, email, password) | `public/index.html`, `public/js/index.js` |
| 3 | Backend validation + duplicate email | `POST /api/auth/register` in `src/routes/authRoutes.js` (+ UNIQUE index) |
| 4 | bcrypt hashing | `bcryptjs` (a pure-JS bcrypt, so it installs on any machine without build tools) |
| 5 | Default role `student` | role is forced server-side; a `role` field in the request is ignored |
| 6 | Login verifies credentials | `POST /api/auth/login` |
| 7 | JWT after login | `signToken()` in `src/middleware/auth.js` (issuer + expiry) |
| 8 | Token stored client-side and sent on every request | `localStorage` + `Authorization: Bearer` header in `API.request()` (`public/js/core.js`) |
| 9 | Student dashboard (name, email, courses) | `public/student.html`, `GET /api/student/dashboard`, catalogue |
| 10 | Authentication middleware | `authenticate` (verifies JWT, loads live user, blocks suspended accounts) |
| 11 | Role-based authorization middleware | `authorize('admin')` etc. Role is read from the database, never trusted from the client |
| 12 | Admin dashboard, admin only | `public/admin.html` + every `/api/admin/*` route behind `authorize('admin')` |
| 13 | Admin add/view/update/delete courses | `src/routes/courseRoutes.js`, Courses page in the admin portal |
| 14 | Students blocked from admin APIs | 403 `FORBIDDEN` (covered by tests) |
| 15 | Logout removes stored auth | `Auth.logout()` clears `localStorage` |
| 16 | Invalid credentials, missing/expired/invalid token, unauthorized | 401 `INVALID_CREDENTIALS`, `MISSING_TOKEN`, `TOKEN_EXPIRED`, `INVALID_TOKEN`; 403 `FORBIDDEN`; front-end redirects with a clear message |

General instructions: jQuery AJAX everywhere · organised folders · all auth checks on the backend · **parameterised SQL only** (`mysql2` placeholders; the few dynamic parts are whitelisted) · no plain-text passwords · no self-assigned admin role.

## 3. What is inside UniSphere
**Students:** dashboard (CGPA, credits, attendance, due work, next classes) · searchable course catalogue · one-click enrol · withdraw · waiting list with auto-promotion · enrolment history · weekly timetable + `.ics` calendar export · assignments with file upload and feedback · learning materials · attendance by course · grades, weighted marks and semester GPA chart · rule-based course recommendations with reasons · AI-style assistant (answers only from the signed-in student's data) · notifications, announcements, academic calendar · messaging · help desk tickets · digital student ID · profile and password change.

**Faculty:** own courses only · class lists · attendance (present/late/absent, low-attendance alerts) · assignments + grading + return for revision · material uploads · grade book + final grade publishing (letter grade and points) · class announcements · "students who may need support" insights with the reasons shown · teaching schedule · messaging.

**Admin:** live overview with charts · people management (create faculty/admin, edit, suspend, reset password) · course CRUD with capacity, instructor, prerequisites and class slots · departments · semesters (current semester, registration open/closed) · academic calendar · enrolment monitor · announcements · help desk assignment and replies · audit log · CSV reports (open in Excel) · system settings (max credits, attendance minimum, pass mark) · **smart timetable generator** (conflict-free rooms and instructors).

**Smart enrolment checks (transactional):** course open · semester registration open · not already enrolled · prerequisites completed · credit-hour limit · timetable clash · seat available (row-locked, so two students can never take the last seat) · otherwise waiting list.

## 4. Security
bcrypt hashing · JWT with expiry + issuer · live account-status check on every request · RBAC · parameterised queries · server-side validation · login rate limiting · Helmet security headers + Content-Security-Policy · file upload whitelist, 10 MB limit, random file names, permission-checked downloads · audit log · CSV export neutralises spreadsheet formulas · XSS-safe rendering (all dynamic text is escaped).
*Note for the report:* the assignment requires `localStorage` for the token. In production, prefer `HttpOnly` secure cookies plus CSRF protection.

## 5. Testing
```bash
npm test                              # builds a separate UniversityDB_test database, then runs 27 integration tests
                                      # your demo data in UniversityDB is never touched
```
Covers: registration (valid/duplicate/invalid), bcrypt storage, login, missing/invalid/expired JWT, 401 vs 403, student blocked from admin APIs, faculty blocked from other faculty's courses, course CRUD + validation, enrolment (duplicate, prerequisites, timetable clash, full course -> waiting list -> auto-promotion, **5 simultaneous requests for the last seat -> exactly one wins**), attendance, assignments with real file upload/download and access control, grading, final grades, admin user/department/semester/announcement/ticket/report/settings APIs and the timetable generator.
Tests run on their own database (`UniversityDB_test`), so they never change or pollute your demo data.

For manual/Postman testing use `POST /api/auth/login`, copy the `token`, and send `Authorization: Bearer <token>`.

## 6. Project structure
```
database/UniversityDB.sql      schema          scripts/  setupDb · seed · createAdmin
server.js                      Express app     tests/    5 test files (node:test)
src/config/db.js               MySQL pool      docs/     architecture, permissions matrix
src/middleware/                auth · upload
src/routes/                    auth · course · enrollment · student · faculty · admin · common
src/services/studentService.js recommendations, GPA, attendance, assistant
src/utils/                     helpers · grading scale · schedule clash logic
public/                        index/student/faculty/admin .html · css/style.css · js/core.js + per-portal JS
public/vendor/                 jQuery 3.7.1, Chart.js 4.4.3 (local copies)
```

## 7. Roadmap (not built yet, honest list)
Email delivery and forgot-password/email verification · real-time notifications (Socket.IO) · QR-code attendance · fees, library, internship and document modules · course reviews · multi-university (multi-tenant) SaaS isolation · LLM-powered assistant (the current one is rule-based by design) · pagination for very large user lists.
