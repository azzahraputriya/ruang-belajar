# Data model (draft)

How Ruang Belajar stores accounts, classes, lessons, and student work. This draft is for discussion, before any schema code.

## Shape

```
User                 username, name, accountType: teacher | student
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
  QuizAttempt     answers, score, attempt number
  Submission      text or files, status, grade, rubric scores, teacher comment
  DiscussionPost  body, optional parent post
  TutorThread     one per student per wrong question
  TutorMessage    role, text, input and output token counts
```

`User` and sessions come from better-auth with its username plugin. Everything else is ours.

## Accounts and roles

- **Account type** decides one thing. Only `teacher` accounts can create a class. It is picked at sign-up.
- **Class role** decides everything inside a class. A class can have several teachers. A teacher account can also be a student in someone else's class.
- Every class query checks `ClassMember` first. No membership, no data.

There are no schools or organizations. Each class stands alone, like a workspace. The class switcher lists the classes you belong to plus your pending invites. The last class you opened is kept in a cookie, not the database.

## Login

Username and password. better-auth still needs an email on every user, so sign-up fills in an address that can't receive mail (`<username>@users.ruang-belajar.invalid`). The tradeoff is no "forgot password" email. See the open question at the end.

## Invites

Classes are invite-only. A teacher invites an existing account by username, as `student` or `teacher`.

| From | Action | To | Who |
|---|---|---|---|
| pending | accept | accepted | invitee |
| pending | decline | declined | invitee |
| pending | revoke | revoked | a class teacher |

Accepting adds the `ClassMember` row in the same transaction. Accepting twice leaves the same result as once. At most one pending invite per class and user. A teacher can remove a member at any time. A class always keeps at least one teacher.

## Step kinds

A step is a tagged union. `kind` picks the shape of `content` and what the student hands in.

| Kind | Content | Student hands in | Scored |
|---|---|---|---|
| `reading` | rich text, images | nothing, marks it done | no |
| `embed` | URL (e.g. a PhET simulation), instructions | nothing, marks it done | no |
| `quiz` | questions, max attempts (default 3), pass score | `QuizAttempt` | yes, best attempt counts |
| `assignment` | prompt, accepts text and/or files, optional rubric | `Submission` | yes, by the teacher |
| `reflection` | prompt | `Submission` (text) | no |
| `discussion` | prompt, required posts and replies | `DiscussionPost` | no |

Quiz questions are auto-graded only: single choice, multiple choice, number, short exact answer. Essays are an `assignment`. The old physics final test (8 choice + 7 essay) becomes one quiz step and one assignment step.

## Answer keys stay on the server

`QuestionKey` is its own table. Code that loads a step for a student cannot select it by accident. Only grading and the AI tutor read it.

## Status is computed, not stored

Each student's status on a step comes from their work rows:

| Status | When |
|---|---|
| not started | no `StepVisit` |
| in progress | visited, not finished |
| needs help | quiz attempts used up below the pass score, or submission returned |
| done | reading/embed marked done, quiz passed, or work submitted |
| graded | submission graded |

## Submission lifecycle

The only stored status. Moves follow this table, nothing else.

| From | Action | To | Who |
|---|---|---|---|
| draft | submit | submitted | student |
| submitted | return with comment | returned | teacher |
| returned | submit | submitted | student |
| submitted | grade | graded | teacher |

Lateness is computed from `submittedAt` and the module's `dueAt`.

## AI tutor

- Off unless the class turns it on (`aiTutorEnabled`) and the student agrees (`aiConsentAt`).
- The student's name is never sent to the model. Only the question, their answer, attempts left, and the key.
- Every message stores its token counts. This gives a record for UU PDP, lets the teacher read the chats, and powers a daily cap per student.

## Files

Uploads store a storage key, not a disk path. They can start on local disk and move to object storage later with no data change.

## Types

- IDs are branded (`ClassId`, `StepId`, ...) so they can't be swapped by mistake.
- Row types are inferred from the Drizzle schema, never written by hand.
- Step `content` and all request input are parsed with ArkType at the server boundary.

## Not in the first version

Comments on announcements, notifications, analytics, offline mode, grade weights, glossary, search.

## Open questions

- Forgotten passwords. With no real email there is no reset link. Options are a reset done by the site admin, or an optional recovery email.
