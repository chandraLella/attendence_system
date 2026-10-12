/* Shapes returned by webapp/main.py. Keep in sync when the backend changes. */
export type Role = "admin" | "employee";
export interface Me { role: Role; name: string; emp_id?: string; server_time: string }

export type WindowState = "upcoming" | "live" | "grace" | "closed";
export interface ClassWindow { start: string; end: string; freeze: string; state: WindowState; open: boolean; now: string }

export type EnrollStatus = "OK" | "PARTIAL" | "FAILED";
export interface Student {
  id: number; roll: string; name: string; status: EnrollStatus; n_views: number; issues: string;
  photo: string | null; section_id: number | null; section: string | null; updated_at: string;
}
export interface StudentView { view: string; crop_path: string; aligned_path: string; blur: number; face_px: number; det: number; yaw: number }
export interface StudentDetail {
  id: number; roll: string; name: string; status: EnrollStatus; issues: string; photo: string | null; section_id: number | null;
  views: StudentView[]; history: { class_date: string; start_time: string; subject: string; status: string }[];
}
export interface Section { id: number; name: string; description: string; students: number; ok: number | null }
export interface Employee { id: number; emp_id: string; name: string; department: string; upcoming: number }

export interface TimetableEntry {
  id: number; emp_id: string; section_id: number; subject: string; room: string;
  class_date: string; start_time: string; end_time: string; section: string; emp_name: string | null;
  session_id: number | null; window: ClassWindow;
}
export interface TodayClass extends TimetableEntry { present: number; total: number }
export interface ScheduleClass extends TodayClass { section_size: number }
export interface Schedule { classes: ScheduleClass[]; server_time: string; grace_minutes: number }

export interface Overview {
  students: number; unassigned: number; sections: number; employees: number; flagged: number;
  enrolled: Partial<Record<EnrollStatus, number>>; today: TodayClass[]; trend: { d: string; p: number; n: number }[];
}

export type MarkStatus = "Present" | "Absent";
export interface RosterRow {
  student_id: number; roll: string; name: string; photo: string | null;
  status: MarkStatus | "Not taken"; source?: "auto" | "manual" | "admin"; score?: number | null;
  evidence?: string | null; updated_by?: string; updated_at?: string; detected?: number | null;
}
export interface UploadRow { id: number; batch: number; filename: string; annotated: string; n_faces: number; n_ok: number; n_matched: number; created_at: string; created_by: string }
export interface Detection { id: number; crop: string; student_id: number | null; score: number; decision: "MATCH" | "REVIEW" | "UNKNOWN" | "REJECTED"; reasons: string; top1_student_id: number | null; top1_score: number | null }
export interface Suggestion { student_id: number; score: number; crop: string; decision: "MATCH" | "REVIEW" }
export interface ClassDetail {
  class: TimetableEntry & { emp_name: string | null }; window: ClassWindow; session_id: number | null; editable: boolean;
  roster: RosterRow[]; uploads: UploadRow[]; suggestions: Suggestion[]; unknown: Detection[]; rejected: number;
  counts: { Present: number; Absent: number; total: number }; thresholds: { match: number; review: number }; server_time: string;
}

export interface Job<R = unknown> { id: string; kind: string; status: "queued" | "running" | "done" | "error"; progress: number; total: number; message: string; result: R | null }
export interface EnrollResult { OK: number; PARTIAL: number; FAILED: number; students: number; created: number; updated: number; duplicates: { a: string; b: string; similarity: number }[] }
export interface RecognizeResult { faces: number; ok: number; matched: number; review: number; unknown: number; rejected: number; newly_present: number; newly_present_names: string[]; batch: number }
export interface SectionImportResult { assigned: number; created_sections: string[]; not_found: string[]; ambiguous: string[]; skipped: number }
export interface AutoAssignResult { assigned: number; left_unassigned?: number; split: { section: string; count: number }[] }
export interface TimetableImportResult { added: number; errors: string[]; created_sections: string[] }

export interface ReportStudent { id: number; roll: string; name: string; cells: string[]; present: number; held: number; pct: number | null }
export interface SectionReport { section: string; start: string; end: string; classes: { id: number; class_date: string; start_time: string; subject: string; emp_id: string; session_id: number | null }[]; classes_taken: number; students: ReportStudent[] }

export interface Settings {
  match_thresh: number; review_thresh: number; grace_minutes: number; det_size: number; tiles: number; det_thresh: number;
  min_face: number; min_blur: number; max_yaw: number; warn_blur: number; duplicate_thresh: number; max_photos_per_upload: number;
}
export interface AuditRow { id: number; ts: string; actor: string; action: string; detail: string }
