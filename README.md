# Turner Finance Futures Program

A small, hostable website for a college case study workflow for Turner Construction Company. It includes a default student view and a password-protected host view.

## What Is Included

- Student View is the default page.
- A bottom button labeled `Host View` opens the host login.
- A bottom `Careers` button links to Turner careers.
- A bottom `Help` button lets students send questions to the host and view posted host answers on their own student page.
- Host password defaults to `123` as requested.
- The top-left header mark uses the attached Turner logo.
- The Student Workspace header uses the attached background image.
- Host can add a case-specific `Case Title`, publish an Excel/CSV case document, and build the instruction checklist as separate sections with an `Add Section` button.
- Host Current Case displays `Currently Working:` with the number of active visitors currently on the student view page.
- Student View shows `Waiting For Host To Begin Case Study.` until the host publishes.
- Students can download the case document, complete checklist items, see progress, chat with the sticky left-side AI Boss, enter their email/college/graduation/major, add resume dashboard details, and upload a completed case document plus a resume.
- Students do not receive an external GPT link. They only use the AI Boss embedded on the student page.
- After submitting, students only see a `Submission Received` confirmation. They do not see the AI Boss report or grade.
- Host can review submissions, click each submitted student name to open a candidate dashboard, download submitted case files, download resumes, see an AI Boss interaction report, see an AI grade, and export the comparison table to CSV.
- The candidate dashboard shows college, expected graduation date, major, email address, number of internships on resume, years of experience on resume, and an industry experience breakdown.
- The resume dashboard fields combine student-entered resume details with a best-effort scan of readable resume text. For production admissions or hiring decisions, review the resume manually.
- AI Boss refuses final-answer requests and redirects students toward source-finding, reasoning, planning, and debugging.

## Run Locally

This app uses Node.js built-in modules only. No package installation is required.

```bash
cd turner-finance-futures-program
npm start
```

Then open:

```text
http://localhost:3000
```

## Host Password

Default password:

```text
123
```

To change it when running the server:

```bash
HOST_PASSWORD="new-password" npm start
```

On Windows PowerShell:

```powershell
$env:HOST_PASSWORD="new-password"; npm start
```

## File Storage

Uploaded case files, student submissions, and resumes are stored on the server under:

```text
storage/uploads
```

Submission, question, and case metadata are stored in:

```text
storage/db.json
```

The host view includes a reset button that deletes the published case, help questions, and all stored submissions.

## Student Help Workflow

Students click `Help`, enter their name, email address, and question, then submit it to the host. The host answers under Host View -> Student Questions. Once posted, the answer appears in that student's Help window for the same browser session.

## Candidate Dashboard Notes

The host can click a student's name in the Student Submissions table to open the dashboard. College, expected graduation date, major, and email come from the student submission form. Internship count, years of experience, and industry breakdown use student-entered resume details when provided; otherwise, the app attempts a no-dependency text scan of the uploaded resume. Some PDF, DOC, or scanned resumes may not be text-readable, so the dashboard includes a confidence note and should be checked against the resume.

## AI Boss And Grading Notes

The included AI Boss is a deterministic coaching simulator so the website works immediately without exposing an API key in the browser. It classifies student prompts as answer-seeking, source-location guidance, debugging, conceptual help, planning, vague, or general coaching.

The AI grade is based on checklist completion and AI Boss interaction behavior. It does not inspect the contents of the uploaded workbook, so the host should use the grade as a quick comparison signal and still review the submitted workbook.

For a production real-AI version, keep model calls on the server, not in browser JavaScript. Replace or extend these functions in `server.js`:

- `generateAiBossReply(...)`
- `generateSubmissionReport(...)`
- `generateAssignmentGrade(...)`
- `buildResumeProfile(...)`

## Production Checklist

Before using this with real students, consider adding:

- School single sign-on or a proper authentication provider.
- Persistent database storage instead of the local JSON file.
- Cloud file storage for submitted Excel documents and resumes.
- HTTPS.
- FERPA/privacy review if student data is collected.
- Server-side virus scanning for uploaded files.
- A real model endpoint if you want live AI rather than the built-in coaching simulator.

## AI Boss Instruction Starter

See `CUSTOM_GPT_INSTRUCTIONS.md` for a paste-ready coaching prompt if you later connect the in-page AI Boss to a real model. The current website does not show students any external GPT link.
