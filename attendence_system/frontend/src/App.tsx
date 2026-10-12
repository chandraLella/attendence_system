import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { RequireRole } from "./auth/AuthContext";
import { NavItem, Shell } from "./components/Shell";
import { Loading } from "./components/ui";
import { ClassPage } from "./features/class/ClassPage";
import Login from "./pages/Login";

const A = {
  Overview: lazy(() => import("./pages/admin/Overview")), Enrollment: lazy(() => import("./pages/admin/Enrollment")),
  Students: lazy(() => import("./pages/admin/Students")), Sections: lazy(() => import("./pages/admin/Sections")),
  Timetable: lazy(() => import("./pages/admin/Timetable")), Attendance: lazy(() => import("./pages/admin/Attendance")),
  Reports: lazy(() => import("./pages/admin/Reports")), Employees: lazy(() => import("./pages/admin/Employees")),
  Settings: lazy(() => import("./pages/admin/Settings")), Activity: lazy(() => import("./pages/admin/Activity")),
};
const E = { Today: lazy(() => import("./pages/employee/Today")), History: lazy(() => import("./pages/employee/History")), Upcoming: lazy(() => import("./pages/employee/Upcoming")) };

const ADMIN_NAV: NavItem[] = [
  { to: "/admin", label: "Overview", icon: "home", end: true }, { to: "/admin/enroll", label: "Enrollment", icon: "enroll" },
  { to: "/admin/students", label: "Students", icon: "students" }, { to: "/admin/sections", label: "Sections", icon: "sections" },
  { to: "/admin/timetable", label: "Timetable", icon: "calendar" }, { to: "/admin/attendance", label: "Attendance", icon: "history" },
  { to: "/admin/reports", label: "Reports", icon: "report" }, { to: "/admin/employees", label: "Employees", icon: "people" },
  { to: "/admin/settings", label: "Recognition settings", icon: "settings" }, { to: "/admin/activity", label: "Activity log", icon: "log" },
];
const EMP_NAV: NavItem[] = [
  { to: "/employee", label: "Today", icon: "clock", end: true }, { to: "/employee/history", label: "Past classes", icon: "history" },
  { to: "/employee/upcoming", label: "Upcoming", icon: "calendar" },
];

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/admin/*" element={<RequireRole role="admin"><Shell sub="Admin" nav={ADMIN_NAV}><Suspense fallback={<Loading />}><Routes>
        <Route index element={<A.Overview />} />
        <Route path="enroll" element={<A.Enrollment />} />
        <Route path="students" element={<A.Students />} />
        <Route path="sections" element={<A.Sections />} />
        <Route path="timetable" element={<A.Timetable />} />
        <Route path="attendance" element={<A.Attendance />} />
        <Route path="reports" element={<A.Reports />} />
        <Route path="employees" element={<A.Employees />} />
        <Route path="settings" element={<A.Settings />} />
        <Route path="activity" element={<A.Activity />} />
        <Route path="class/:id" element={<ClassPage role="admin" back="/admin/attendance" />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes></Suspense></Shell></RequireRole>} />
      <Route path="/employee/*" element={<RequireRole role="employee"><Shell sub="Employee" nav={EMP_NAV}><Suspense fallback={<Loading />}><Routes>
        <Route index element={<E.Today />} />
        <Route path="history" element={<E.History />} />
        <Route path="upcoming" element={<E.Upcoming />} />
        <Route path="class/:id" element={<ClassPage role="employee" back="/employee" />} />
        <Route path="*" element={<Navigate to="/employee" replace />} />
      </Routes></Suspense></Shell></RequireRole>} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
