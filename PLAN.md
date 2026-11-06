# Plan

Ruang Belajar is an LMS for any class and any subject. A teacher creates an invite-only class, writes modules of steps (readings, quizzes, assignments, discussions), and students work through them. An AI tutor helps a student after a wrong quiz answer, without giving the answer away.

This file is the roadmap. To pick up work, take the first phase that is `in progress` or `not started` and not blocked. `in review` means it is waiting on a person to merge, so skip it. Read the phase's "Done when" and work toward that. Update the status table in the same PR that changes it.

## Status

| Phase                           | Status      | PRs                  |
| ------------------------------- | ----------- | -------------------- |
| 0. Repo setup                   | in review   | #1 to #5, release #6 |
| 1. Accounts                     | in progress |                      |
| 2. Deploy                       | in progress |                      |
| 3. Classes and invites          | not started |                      |
| 4. Content: modules and steps   | not started |                      |
| 5. Quizzes                      | not started |                      |
| 6. Assignments and grading      | not started |                      |
| 7. Discussion and announcements | not started |                      |
| 8. AI tutor                     | not started |                      |

Phases 1 to 8 each end in a working, tested slice. Phase 2 can run alongside phase 3.

## Phases

### 0. Repo setup

TanStack Start app, lint and format hooks, CI, branch protection, agent rules (`AGENTS.md`), PR template, and `pr-format` as a required check. Then shadcn/ui with the blue theme, and a `verify` skill that checks changes in a real browser.

Each phase ships as a `release/phase-<n>` branch with one PR into `main`. Feature branches open PRs into the release branch. CI runs on both.

### 1. Accounts

Postgres in a Docker container, Drizzle schema and migrations, better-auth with username and password.

- Sign up with username, display name, and password. better-auth needs an email, so sign-up fills in `<username>@users.ruang-belajar.invalid`.
- Sign in, sign out, and a session that survives a reload.
- A `docker compose` file runs the same Postgres locally and on the VPS.

Done when: a test against a real Postgres signs up, signs in, reads the session, and signs out. A duplicate username is rejected.

### 2. Deploy

Run the app on the VPS for real users.

- Production build in a container, as a non-root user, next to the Postgres container.
- Public at `lms.afiefabd.com`. The domain is already on Cloudflare, and this VPS already runs a Cloudflare Tunnel for another hostname. Add an ingress rule to that tunnel instead of creating a second one, so no ports are opened.
- That tunnel also carries remote access to this machine. Keep its existing rules, run `cloudflared tunnel ingress validate` before restarting it, and confirm the old hostname still works afterwards. Get Afief's go-ahead before the restart.
- No backups (Afief's call). Keep the Postgres data in a named Docker volume so restarts and rebuilds don't lose it.

Done when: `https://lms.afiefabd.com` serves the app, a test account survives a container rebuild, and the tunnel's other hostname still works.

### 3. Classes and invites

The `Class`, `ClassMember`, and `ClassInvite` tables from `docs/data-model.md`, and the class switcher UI.

- Anyone signed in creates a class and becomes its first teacher.
- Teachers invite by username, as student (default) or teacher. The invitee accepts or declines, and a teacher can revoke.
- Teachers change roles and remove members. A class always keeps at least one teacher.
- The class switcher works like an account switcher. It lists your classes and pending invites, and remembers the last class in a cookie.

Done when: tests cover every invite transition, accepting twice, and the last-teacher rule. A user who isn't in a class gets nothing from any class query. The switcher has passed a mock review first.

### 4. Content: modules and steps

`Module` and `Step`, starting with the `reading` and `embed` step kinds. Teachers create, edit, and reorder modules and steps. Students read them in order. `StepVisit` records progress.

Done when: a student's status on each step (not started, in progress, done) is computed from their visits, and tested.

### 5. Quizzes

The `quiz` step kind, `Question`, `QuestionKey`, and `QuizAttempt`. Auto-grading for single choice, multiple choice, number, and short exact answers. Max attempts (default 3), and the best attempt counts.

Done when: tests prove `QuestionKey` never reaches the browser, and the "needs help" status appears after the last failed attempt. Add the custom lint rule that keeps answer keys server-only (see `docs/lint-rules.md`).

### 6. Assignments and grading

The `assignment` and `reflection` step kinds, and `Submission` with its lifecycle (draft, submitted, returned, graded). File uploads go to local disk under a storage key. Teachers grade with a rubric, comment, or return the work for revision.

Done when: every lifecycle transition is tested, including resubmitting after a return. Lateness is computed from the module's due date.

### 7. Discussion and announcements

The `discussion` step kind (required posts and replies) and class `Announcement`s from teachers.

Done when: a discussion step counts as done after the required posts and replies, and students see announcements in their class.

### 8. AI tutor

After a wrong quiz answer, the student can open a tutor chat about that question.

- Only when the class has the tutor on and the student has agreed (`aiTutorEnabled`, `aiConsentAt`). The consent text says what is sent, to whom, and why. Afief approves the wording before release.
- Claude Haiku 5.5 through the Anthropic SDK, billed to Afief's personal Anthropic account. The API key lives only in the VPS environment, never in the repo. Start from the tested tutor prompt in `../mspd/a6/lampiran/tutor-v2.md`, made subject-neutral.
- Never send the student's name. While attempts remain, never reveal the answer.
- Store each message with its token counts, enforce a daily cap per student, and let teachers read the chats.

Done when: replays of the `../mspd/a6` test students pass (no early answer, no made-up questions, short replies), and the daily cap blocks the next message.

## Decisions

Settled by Afief, with the reason where it isn't obvious:

- **One VPS for everything.** Usage will be near zero. Measured: the app server uses 62 to 155 MB of RAM, and Postgres 38 to 46 MB.
- **Postgres in one container, no Redis.** Sessions and the AI daily cap fit in Postgres.
- **Roles exist only inside a class.** There are no organizations and no account types.
- **Username and password login.** No password reset in the first version.
- **Libraries.** Drizzle, better-auth, ArkType. See `docs/data-model.md`.
- **UI.** shadcn/ui components. Any new screen gets design mocks before it is built.
- **The AI model is hosted.** A local model is not realistic on 4 CPU cores with no GPU. Afief's personal Anthropic account pays. Estimated cost is about Rp11 per tutor reply on Haiku 5.5, assuming about 4.000 tokens in and 500 out per reply and about Rp16.500 per USD.
- **The UI is in Bahasa Indonesia.**
- **Tests use Vitest,** with database tests against a real Postgres container.
- **Data fetching uses TanStack Start server functions with TanStack Query.**
- **Domain.** Probably `lms.afiefabd.com`. Confirm with Afief before adding the DNS record.
- **No backups for now.** Accepted risk: if the VPS disk or the Postgres volume is lost, all accounts and class data are lost.
- **Consent.** The tutor sends student work to an outside AI service, which counts as personal data under UU PDP (Law No. 27/2022). Afief approves the consent text and its stated purpose.

## Open decisions

None right now. Add any new question here with the phase it blocks.

## Constraints

- **Disk.** The VPS disk is about 90% full, with about 16 GB free on 06 November 2026. Uploads are the only data that grows without limit. Watch it, and move uploads to object storage before it becomes a problem.
- **Shared machine.** The VPS is also a work machine. The app runs as a non-root container, and nothing on it is exposed except through the tunnel.

## Not planned

Organizations or schools, Google login, password reset, notifications, comments on announcements, analytics, offline mode, grade weights, glossary, search, Redis.
