# Rollcall React frontend

React 18 + TypeScript + Vite + React Router. No UI library; styles are in `src/styles/app.css`.
Talks to the FastAPI backend in `../webapp` through the same `/api/*` and `/media/*` routes.

## Develop

```bash
# terminal 1, from attendance_system/
uvicorn webapp.main:app --port 8000

# terminal 2
cd frontend
npm install
npm run dev            # http://localhost:5173
```
Vite proxies `/api` and `/media` to `http://127.0.0.1:8000` (override with `VITE_BACKEND=...`),
so the session cookie is same-origin and the backend needs no CORS settings.

## Production

```bash
cd frontend && npm run build          # writes frontend/dist
cd .. && uvicorn webapp.main:app --host 0.0.0.0 --port 8000
```
When `frontend/dist/index.html` exists, FastAPI serves the React app at `/login`, `/admin/*` and
`/employee/*` (deep links like `/employee/class/12` work after refresh). Delete `dist/` to fall back
to the original static pages. Point elsewhere with `ATT_FRONTEND_DIST=/path/to/dist`.

## Layout

```
src/
├── api/
│   ├── types.ts        response shapes from webapp/main.py (update here when the API changes)
│   ├── client.ts       fetch wrapper, 401 handling, XHR upload with progress, pollJob()
│   └── endpoints.ts    one typed function per backend route
├── auth/AuthContext.tsx  session state, login/logout, <RequireRole> route guard
├── lib/                time (server-clock offset, window state), hooks (useAsync, useTick, useDebounced)
├── components/         Shell, Modal + useConfirm, Toast, Dropzone, Face, tags, small UI pieces
├── features/class/     class attendance screen shared by employee and admin:
│                       Timeline, PhotoUploader, Roster, Suggestions, UnknownFaces, ProcessedPhotos
└── pages/
    ├── Login.tsx
    ├── admin/          Overview, Enrollment, Students, Sections, Timetable, Attendance,
    │                   Reports, Employees, Settings, Activity
    └── employee/       Today, History, Upcoming
```

## Notes

- The server remains the authority. The UI hides upload and edit controls outside the class window,
  but the API rejects them regardless, so a stale tab can't edit a frozen class.
- Countdowns use the server's clock (offset taken from `server_time` in responses), not the laptop's.
- When a class crosses start, end or freeze, the page re-fetches so the server decides what's editable.
- Attendance toggles update optimistically and roll back with a toast if the server refuses.
- Long jobs (zip enrollment, photo recognition) return a `job_id`; `pollJob()` drives the progress bar.
