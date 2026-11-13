# Architecture notes

## Roles and permissions
| Capability | Student | Faculty | Admin |
|---|---|---|---|
| Register publicly | yes (always `student`) | no | no |
| Create faculty / admin accounts | no | no | yes |
| Browse courses, view details | yes | yes | yes |
| Create / edit / delete courses | no | no | yes |
| Enrol, withdraw, join waiting list | yes | no | no |
| Mark attendance, post grades, create assignments | no | own courses only | no |
| Submit assignments | yes (enrolled) | no | no |
| Manage users, departments, semesters, settings | no | no | yes |
| Publish university-wide announcements | no | no | yes |
| Class announcements | no | own courses | no |
| View audit log, reports | no | no | yes |

## Key relationships
users 1-* enrollments *-1 courses · courses 1-* timetables · courses *-* courses (course_prerequisites) · courses 1-* assignments 1-* submissions · courses 1-* attendance/grades/materials · departments 1-* courses, users · semesters 1-* courses · users 1-* notifications, messages, support_tickets, audit_logs · courses 1-* waitlists

## Request flow
Browser (jQuery `$.ajax` + `Authorization: Bearer`) -> Express -> `authenticate` (JWT verify + DB lookup) -> `authorize(role)` -> route handler -> parameterised SQL (transaction where needed) -> JSON.

## Concurrency
Enrolment locks the `courses` row (`SELECT ... FOR UPDATE`) inside a transaction, then counts seats, so concurrent requests are serialised per course.
