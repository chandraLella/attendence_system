/* One typed function per backend route. Components import from here, never build URLs themselves. */
import { del, get, patch, post, put, qs, upload } from "./client";
import type * as T from "./types";

type Progress = (p: number) => void;
const file = (f: File, extra: Record<string, string | boolean> = {}) => {
  const fd = new FormData(); fd.append("file", f);
  Object.entries(extra).forEach(([k, v]) => fd.append(k, String(v)));
  return fd;
};

export const auth = {
  me: () => get<T.Me>("/api/me"),
  login: (body: { role: T.Role; username: string; password: string; emp_id?: string }) => post<T.Me>("/api/login", body),
  logout: () => post<{ ok: boolean }>("/api/logout"),
};

export const templates = { url: (kind: "sections" | "timetable") => `/api/templates/${kind}` };

export const admin = {
  overview: () => get<T.Overview>("/api/admin/overview"),

  enrollZip: (f: File, p?: Progress) => upload<{ job_id: string }>("/api/admin/enroll", file(f), p),
  students: (f: { q?: string; section_id?: string; status?: string } = {}) => get<T.Student[]>(`/api/admin/students?${qs(f)}`),
  student: (id: number) => get<T.StudentDetail>(`/api/admin/students/${id}`),
  updateStudent: (id: number, body: Partial<{ name: string; roll: string; section_id: number | null }>) => patch(`/api/admin/students/${id}`, body),
  deleteStudent: (id: number) => del(`/api/admin/students/${id}`),
  moveStudents: (student_ids: number[], section_id: number | null) => post<{ updated: number }>("/api/admin/students/bulk-section", { student_ids, section_id }),

  createSection: (name: string, description = "") => post<{ id: number }>("/api/admin/sections", { name, description }),
  updateSection: (id: number, body: { name?: string; description?: string }) => patch(`/api/admin/sections/${id}`, body),
  deleteSection: (id: number) => del(`/api/admin/sections/${id}`),
  autoAssign: (body: { section_ids: number[]; by: "name" | "roll"; mode: "equal" | "capacity"; capacity?: number; scope: "unassigned" | "all" }) =>
    post<T.AutoAssignResult>("/api/admin/sections/auto-assign", body),
  importSections: (f: File, create_missing: boolean) => upload<T.SectionImportResult>("/api/admin/sections/import", file(f, { create_missing })),

  employees: () => get<T.Employee[]>("/api/admin/employees"),
  saveEmployee: (body: { emp_id: string; name: string; department: string }) => post("/api/admin/employees", body),
  deleteEmployee: (emp_id: string) => del(`/api/admin/employees/${encodeURIComponent(emp_id)}`),

  timetable: (f: { start?: string; end?: string; section_id?: string; emp_id?: string }) => get<T.TimetableEntry[]>(`/api/admin/timetable?${qs(f)}`),
  addClass: (body: { emp_id: string; section_id: number; subject: string; room: string; class_date: string; start_time: string; end_time: string; repeat_until?: string | null }) =>
    post<{ added: number; errors: string[] }>("/api/admin/timetable", body),
  deleteClass: (id: number) => del(`/api/admin/timetable/${id}`),
  importTimetable: (f: File, create_missing: boolean) => upload<T.TimetableImportResult>("/api/admin/timetable/import", file(f, { create_missing })),

  report: (sectionId: number, start: string, end: string) => get<T.SectionReport>(`/api/admin/reports/section/${sectionId}?${qs({ start, end })}`),
  reportXlsxUrl: (sectionId: number, start: string, end: string) => `/api/admin/reports/section/${sectionId}?${qs({ start, end, fmt: "xlsx" })}`,

  settings: () => get<T.Settings>("/api/admin/settings"),
  saveSettings: (s: Partial<T.Settings>) => put<T.Settings>("/api/admin/settings", s),
  audit: (limit = 200) => get<T.AuditRow[]>(`/api/admin/audit?limit=${limit}`),
};

export const sections = { list: () => get<T.Section[]>("/api/sections") };

export const employee = {
  schedule: (start?: string, end?: string) => get<T.Schedule>(`/api/employee/schedule?${qs({ start, end })}`),
};

export const classes = {
  detail: (tid: number) => get<T.ClassDetail>(`/api/class/${tid}`),
  uploadPhotos: (tid: number, files: File[], p?: Progress) => {
    const fd = new FormData(); files.forEach((f) => fd.append("files", f));
    return upload<{ job_id: string }>(`/api/class/${tid}/photos`, fd, p);
  },
  mark: (tid: number, student_ids: number[], status: T.MarkStatus, evidence?: string) =>
    patch<{ updated: number }>(`/api/class/${tid}/attendance`, { student_ids, status, evidence }),
  exportUrl: (tid: number) => `/api/class/${tid}/export`,
};
