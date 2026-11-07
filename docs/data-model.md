# Data model (draft)

How Ruang Belajar stores accounts, classes, lessons, and student work. This draft is for discussion, before any schema code.

## Shape

```
User                 username, name
Class                title, subject, aiTutorEnabled
├─ ClassMember       class role: teacher | student, aiConsentAt
├─ ClassInvite       invitee, role, status (see below)
├─ Announcement      author, body, createdAt, editedAt
└─ Module            position, opensAt, dueAt
   └─ Step           position, kind (see below), content
      └─ Question         quiz steps only, what students see
         └─ QuestionKey   correct answer, feedback, solution steps

Student work, one row per thing that happened:
  StepVisit       student opened or finished a step
  QuizAttempt     answers, which were right, score, attempt number
  Submission      text or files, status, grade, rubric scores, teacher comment
  DiscussionPost  body, optional parent post
  TutorThread     one per student per wrong question
  TutorMessage    role, text, input and output token counts
```

`User` and sessions come from better-auth with its username plugin. Everything else is ours.

## Roles

Roles live only inside a class: `teacher` or `student`. Accounts have no type.

- Anyone signed in can create a class and becomes its first teacher.
- A class can have several teachers. The same person can teach one class and study in another.
- A teacher can change any member's role, for example promote a student to teacher.
- Every class query checks `ClassMember` first. No membership, no data.

There are no schools or organizations. Each class stands alone, like a workspace. The class switcher lists the classes you belong to plus your pending invites. The last class you opened is kept in a cookie, not the database.

## Login

Username and password. better-auth still needs an email on every user, so sign-up fills in an address that can't receive mail (`<username>@users.ruang-belajar.invalid`). There is no password reset in the first version.

## Invites

Classes are invite-only. A teacher invites an existing account by username. The role defaults to `student`, and the teacher can pick `teacher` instead.

| From    | Action  | To       | Who             |
| ------- | ------- | -------- | --------------- |
| pending | accept  | accepted | invitee         |
| pending | decline | declined | invitee         |
| pending | revoke  | revoked  | a class teacher |

Accepting adds the `ClassMember` row in the same transaction. Accepting twice leaves the same result as once. At most one pending invite per class and user.

- Repeating a move that already happened (accept, decline, or revoke twice) succeeds and changes nothing. So a member who was removed can't rejoin by replaying an old accept.
- Any other move out of a closed invite is refused. You can't accept after a decline or a revoke. The teacher sends a new invite instead.
- The invitee isn't a member yet, but still sees the class title and the inviter's username in their pending invites. Nobody else outside the class can see the class or the invite. A teacher can remove a member at any time. A class always keeps at least one teacher, so the last teacher can't leave, be removed, or be changed to student.

## Step kinds

A step is a tagged union. `kind` picks the shape of `content` and what the student hands in.

| Kind         | Content                                            | Student hands in       | Scored                   |
| ------------ | -------------------------------------------------- | ---------------------- | ------------------------ |
| `reading`    | rich text, images                                  | nothing, marks it done | no                       |
| `embed`      | URL (e.g. a PhET simulation), instructions         | nothing, marks it done | no                       |
| `quiz`       | questions, max attempts (default 3), pass score    | `QuizAttempt`          | yes, best attempt counts |
| `assignment` | prompt, accepts text and/or files, optional rubric | `Submission`           | yes, by the teacher      |
| `reflection` | prompt                                             | `Submission` (text)    | no                       |
| `discussion` | prompt, required posts and replies                 | `DiscussionPost`       | no                       |

Each kind is one entry in `src/server/step-kinds.ts`: its content shape, whether the student marks it finished, and how its status is computed. Adding a kind is one value in the `step_kind` enum (a migration) plus one entry there.

- `reading` content is a markdown `body`. Images are markdown image links until uploads arrive with assignments.
- `embed` content is an https `url` and markdown `instructions`. Other schemes are refused.
- A step's kind can't change after it is created.

Quiz questions are auto-graded only: single choice, multiple choice, number, short exact answer. Essays are an `assignment`. The old physics final test (8 choice + 7 essay) becomes one quiz step and one assignment step.

## Quizzes

`quiz` content is `maxAttempts` (1 to 10, default 3) and `passScore` (a whole percent, default 70). Questions are rows, not content. Each question kind is one entry in `src/server/question-kinds.ts`: its choices, key shape, answer shape, and grading rule.

| Kind              | Key                                 | Right when                                                                  |
| ----------------- | ----------------------------------- | --------------------------------------------------------------------------- |
| `single_choice`   | one choice id                       | the same id                                                                 |
| `multiple_choice` | one or more choice ids              | exactly the same set. No partial credit.                                    |
| `number`          | `value` and an absolute `tolerance` | within `value ± tolerance`, with a tiny slack for floating-point error      |
| `short_text`      | the text                            | equal after trimming, collapsing inner whitespace, and ignoring letter case |

- A score is the percent of questions right, rounded down. With a whole-number pass score, rounding down never changes a pass. Unanswered questions count as wrong.
- An answer of the wrong shape, or for a question that isn't in the quiz, refuses the whole attempt and stores nothing. A quiz with no questions can't be submitted.
- The best attempt counts. A pass closes the quiz: no more attempts after it. Out of attempts below the pass score is `needs help`.
- Attempt numbers are given out under the class lock, so two submits at once can't share a number or go past the limit. A unique index on (step, student, attempt number) is the backstop.
- `maxAttempts` and `passScore` are read live. A teacher who lowers the pass score passes earlier attempts that now reach it. Raising `maxAttempts` reopens a quiz that ran out, even though its solutions were shown.
- Editing or deleting a question doesn't regrade attempts already submitted. Each attempt stores which questions were right when it was graded, so its result list survives a reload and a later edit. Attempts from before that was stored show each question as unknown, not wrong.
- Only students take quizzes. A teacher gets `forbidden` and edits through the teacher view, which includes the keys.

## Answer keys stay on the server

`QuestionKey` is its own table, in its own schema file (`src/db/question-key-schema.ts`). It is left out of `src/db/schema.ts`, which keeps it off `db.query` but not off `db.select()`. The real guard is the lint rule `ruang/question-key-server-only`, which lets only `src/server/quizzes.ts` (and later the AI tutor) import it. Only grading, the teacher's views, and the reveal below read it.

- While attempts remain, a student sees only which questions they got right. Never the correct answer, the feedback, or the solution.
- After they pass, they see the correct answer, feedback, and solution of every question.
- Running out of attempts reveals nothing. Their status becomes "needs help", and the teacher (or the AI tutor) helps. A teacher can raise `maxAttempts` to let them try again, which stays fair because they never saw the answers.

## Status is computed, not stored

Each student's status on a step comes from their work rows:

| Status      | When                                                               |
| ----------- | ------------------------------------------------------------------ |
| not started | no `StepVisit` and no `QuizAttempt`                                |
| in progress | visited or attempted, not finished                                 |
| needs help  | quiz attempts used up below the pass score, or submission returned |
| done        | reading/embed marked done, quiz passed, or work submitted          |
| graded      | submission graded                                                  |

A `StepVisit` is an `opened` or `finished` event, and repeats are stored. Status reads the events as a set, so a repeat never changes it.

- `finished` without an earlier `opened` still counts as done.
- Only students record visits. A teacher gets `forbidden`.
- `finished` is only allowed on kinds the student marks done themselves.

## Modules and order

- Modules are ordered within a class and steps within a module. Positions are always 0 to n-1. A delete closes the gap.
- A reorder sends the full list of ids. It is refused, and nothing moves, unless the list has exactly the current ids, each once.
- A student sees a module only once its `opensAt` has passed, or when it has none. Before that, its steps are `not_found` to students. Teachers see every module.

## Submission lifecycle

The only stored status. Moves follow this table, nothing else.

| From      | Action              | To        | Who     |
| --------- | ------------------- | --------- | ------- |
| draft     | submit              | submitted | student |
| submitted | return with comment | returned  | teacher |
| returned  | submit              | submitted | student |
| submitted | grade               | graded    | teacher |

Lateness is computed from `submittedAt` and the module's `dueAt`.

## AI tutor

- Off unless the class turns it on (`aiTutorEnabled`) and the student agrees (`aiConsentAt`).
- The student's name is never sent to the model. Only the question, their answer, attempts left, and the key.
- Every message stores its token counts. This gives a record for UU PDP, lets the teacher read the chats, and powers a daily cap per student.

## Files

Uploads store a storage key, not a disk path. They can start on local disk and move to object storage later with no data change.

## Storage and types

- Postgres 16 in one Docker container on the VPS, accessed through Drizzle. No Redis.
- IDs are branded (`ClassId`, `StepId`, ...) so they can't be swapped by mistake.
- Row types are inferred from the Drizzle schema, never written by hand.
- Step `content` and all request input are parsed with ArkType at the server boundary.

## Not in the first version

Comments on announcements, password reset, notifications, analytics, offline mode, grade weights, glossary, search.
