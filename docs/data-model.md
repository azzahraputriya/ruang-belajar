# Data model (draft)

How Ruang Belajar stores schools, classes, lessons, and student work. This draft is for discussion, before any schema code.

## Shape

```
Organization (a school)
├─ Member            org role: admin | teacher | student
└─ Class             title, subject, joinCode, aiTutorEnabled
   ├─ ClassMember    class role: teacher | student, aiConsentAt
   └─ Module         position, opensAt, dueAt
      └─ Step        position, kind (see below), content
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

`Organization` and `Member` come from the better-auth organization plugin. Everything else is ours.

## Two kinds of role

- The **org role** only decides who may create classes (admin and teacher).
- The **class role** decides everything inside a class.

The same person can teach one class and take another. A class belongs to exactly one org, and every class query filters by org, so data never crosses schools.

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

## Joining with a code

The better-auth `addMember` call checks nothing by itself, so the join function owns every check:

1. Require a signed-in user.
2. Find the class by code. Reject unknown or disabled codes.
3. Add the user to the org as `student`, unless they are already a member.
4. Add the user to the class as `student`, unless they are already in it.

Running it twice leaves the same result as running it once.

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

Announcements, notifications, analytics, offline mode, grade weights, glossary, search.
