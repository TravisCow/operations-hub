# Verification record

October 21, 2026. Local prototype on Windows, Node.js 22.14.0, npm 10.9.2.

## Automated checks

- Clean installation from package-lock.json with lifecycle scripts disabled: passed.
- TypeScript checking and frontend bundle: passed.
- Twelve integration/database tests: passed. Tests cover HTTP behavior and independent SQLite connections, not mocked success alone.
- Twelve simultaneous matching HTTP deliveries returned the existing request without adding activity. Four independent database connections racing for a new event produced one new request.
- A reopened database retained request data and its unique event ID.
- An activity-insert failure rolled back the entire intake transaction.
- A simulated unavailable save returned 503 with Retry-After; retrying the same event ID saved it once.
- Credential checks, validation, conflict responses, local origin/Host checks, transition rules, version conflicts, and closed-record rejection passed.
- Client-bundle inspection found no integration-key environment variable or header name. The test log captures contained no request payloads or test credential.
- npm audit reported 0 known dependency advisories at verification time. This does not certify the application as secure.

## Browser verification

- Submitted the sample form; a new request appeared in the queue.
- Resent the same delivery; the queue remained at one request, with one intake activity.
- Assigned an owner, advanced to in progress, and closed the request. Closed controls became read-only and history retained all transitions.
- Restarted the actual server process and refreshed: both saved requests remained, including the closed request and its history.
- Introduced a temporary SQLite insert trigger in the fictional local QA database to reject new intakes. The UI displayed a clear error and correlation reference.
- Removed the QA trigger and retried the same delivery from the UI. It saved one request. The QA trigger is removed; it is not part of the application source or deployment.
- Inspected 1366px desktop and 390px mobile layouts. Neither had horizontal page overflow. Screenshots record desktop, mobile, and failure states.

## Remaining limits

No public deployment, independent accessibility audit, browser automation regression suite, external-provider interoperability test, production load test, or backup/restore qualification is claimed. Operator access is local only. Public hosting requires deliberate persistent storage and access design; see README.md.
