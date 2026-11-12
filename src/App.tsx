import { lazy } from "react";
import { Navigate, Route, Routes } from "react-router";
import RequireAuth from "@/auth/RequireAuth";
import AppLayout from "@/components/layout/AppLayout";
import AcceptInvite from "@/pages/auth/AcceptInvite";
import ForgotPassword from "@/pages/auth/ForgotPassword";
import Login from "@/pages/auth/Login";
import ResetPassword from "@/pages/auth/ResetPassword";
const Activity = lazy(() => import("@/pages/Activity"));
const Calendar = lazy(() => import("@/pages/Calendar"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const LeadDetail = lazy(() => import("@/pages/LeadDetail"));
const Leads = lazy(() => import("@/pages/Leads"));
const Pipeline = lazy(() => import("@/pages/Pipeline"));
const Reports = lazy(() => import("@/pages/Reports"));
const Settings = lazy(() => import("@/pages/Settings"));
const Tasks = lazy(() => import("@/pages/Tasks"));

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login/>}/>
      <Route path="/forgot-password" element={<ForgotPassword/>}/>
      <Route path="/reset/:token" element={<ResetPassword/>}/>
      <Route path="/invite/:token" element={<AcceptInvite/>}/>
      <Route element={<RequireAuth><AppLayout/></RequireAuth>}>
        <Route index element={<Dashboard/>}/>
        <Route path="leads" element={<Leads/>}/>
        <Route path="leads/:id" element={<LeadDetail/>}/>
        <Route path="pipeline" element={<Pipeline/>}/>
        <Route path="tasks" element={<Tasks/>}/>
        <Route path="calendar" element={<Calendar/>}/>
        <Route path="activity" element={<Activity/>}/>
        <Route path="reports" element={<Reports/>}/>
        <Route path="settings" element={<Navigate to="/settings/team" replace/>}/>
        <Route path="settings/:tab" element={<Settings/>}/>
      </Route>
      <Route path="*" element={<Navigate to="/" replace/>}/>
    </Routes>
  );
}
