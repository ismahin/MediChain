import type * as React from "react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Bell, FileCheck2, HeartPulse, LogOut, Menu, Search, ShieldCheck, UploadCloud, UserCheck } from "lucide-react";
import { api, unwrap } from "../api/client";
import { useAuth } from "../contexts/AuthContext";
import { useMetaMask } from "../hooks/useMetaMask";
import type { MedicalRecord, Role, User } from "../types";
import { BlockchainStatusBadge, Button, Card, Input, SecurityNote, Select, Textarea } from "../components/ui";

type PatientSummary = {
  id: string;
  healthId: string;
  bloodGroup?: string;
  user: Pick<User, "id" | "fullName" | "email">;
};

const nav: Record<Role, string[]> = {
  PATIENT: ["Overview", "Medical Timeline", "Prescriptions", "Diagnostic Reports", "Access Requests", "Shared Access", "Blockchain Verification", "Emergency Profile", "Notifications", "Settings"],
  DOCTOR: ["Overview", "Patient Search", "Access Requests", "My Consultations", "Create Prescription", "Medical Records", "Blockchain Activity", "Profile & Verification"],
  HOSPITAL: ["Overview", "Patient Registration", "Admissions", "Discharge Summaries", "Surgery Records", "Medical Documents", "Access Requests", "Staff Doctors", "Blockchain Logs", "Profile"],
  LABORATORY: ["Overview", "Patient Search", "Upload Diagnostic Report", "My Reports", "Verification", "Access Requests", "Blockchain Logs", "Profile"],
  ADMIN: ["Overview", "Users", "Doctor Verification", "Hospital Verification", "Laboratory Verification", "Medical Records Monitor", "Blockchain Monitor", "Emergency Access Audit", "Access Audit Logs", "System Settings"]
};

export function DashboardPage() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const wallet = useMetaMask();
  if (!user) return null;

  return (
    <div className="min-h-screen bg-sky-50">
      <aside className={`fixed inset-y-0 left-0 z-40 w-72 border-r border-sky-100 bg-white p-5 transition md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <Link to="/" className="flex items-center gap-2 text-2xl font-black text-medical-700"><HeartPulse />MediChain</Link>
        <div className="mt-6 rounded-lg bg-sky-50 p-4">
          <div className="font-black">{user.fullName}</div>
          <div className="text-sm font-semibold text-medical-700">{user.role}</div>
        </div>
        <nav className="mt-6 space-y-1">{nav[user.role].map((item) => <a key={item} href={`#${item.toLowerCase().replaceAll(" ", "-")}`} className="block rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-sky-50">{item}</a>)}</nav>
        <button onClick={logout} className="mt-6 flex items-center gap-2 rounded-lg px-3 py-2 font-bold text-red-600"><LogOut size={18} />Logout</button>
      </aside>

      <main className="md:pl-72">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-sky-100 bg-white/85 px-5 py-4 backdrop-blur">
          <button onClick={() => setOpen(!open)} className="md:hidden"><Menu /></button>
          <div>
            <div className="text-sm font-bold text-medical-700">MediChain Dashboard</div>
            <h1 className="text-2xl font-black text-slate-950">{user.role.charAt(0) + user.role.slice(1).toLowerCase()} Workspace</h1>
          </div>
          <div className="hidden items-center gap-3 md:flex">
            {wallet.address ? <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-green-700">{wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}</span> : <Button onClick={wallet.connect} className="bg-teal-600 hover:bg-teal-700">Connect MetaMask</Button>}
          </div>
        </header>

        <div className="space-y-6 p-5">
          <SecurityNote />
          {wallet.error && <div className="rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-700">{wallet.error}</div>}
          {user.role === "PATIENT" && <PatientDashboard />}
          {user.role === "DOCTOR" && <DoctorDashboard />}
          {user.role === "HOSPITAL" && <HospitalDashboard />}
          {user.role === "LABORATORY" && <LabDashboard />}
          {user.role === "ADMIN" && <AdminDashboard />}
        </div>
      </main>
    </div>
  );
}

function StatsGrid({ stats }: { stats: Record<string, number | string | undefined> }) {
  return <div className="grid gap-4 md:grid-cols-4">{Object.entries(stats).map(([key, value]) => <Card key={key}><div className="text-2xl font-black text-medical-700">{value ?? 0}</div><div className="mt-1 text-sm font-semibold capitalize text-slate-500">{key.replaceAll(/([A-Z])/g, " $1")}</div></Card>)}</div>;
}

function StatusMessage({ message }: { message?: string }) {
  if (!message) return null;
  const success = !message.toLowerCase().includes("error") && !message.toLowerCase().includes("failed") && !message.toLowerCase().includes("not granted");
  return <div className={`rounded-lg p-3 text-sm font-semibold ${success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{message}</div>;
}

function PatientSearchCard({
  title,
  query,
  setQuery,
  patients,
  selectedPatient,
  onSelect,
  onRequestAccess,
  requesting
}: {
  title: string;
  query: string;
  setQuery: (value: string) => void;
  patients: PatientSummary[];
  selectedPatient?: PatientSummary | null;
  onSelect: (patient: PatientSummary) => void;
  onRequestAccess: (patientId: string) => void;
  requesting?: boolean;
}) {
  return (
    <Card>
      <h2 className="mb-4 flex items-center gap-2 text-xl font-black"><Search />{title}</h2>
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by Health ID, e.g. MCH-2026-000001" />
      {selectedPatient && <div className="mt-3 rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-700">Selected: {selectedPatient.user.fullName} ({selectedPatient.healthId})</div>}
      <div className="mt-4 space-y-3">
        {patients.map((patient) => (
          <div key={patient.id} className="rounded-lg bg-sky-50 p-3">
            <div className="font-bold">{patient.user.fullName}</div>
            <div className="text-sm text-slate-600">{patient.healthId}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" onClick={() => onSelect(patient)} className="bg-teal-600 hover:bg-teal-700">Select Patient</Button>
              <Button type="button" onClick={() => onRequestAccess(patient.id)} disabled={requesting}>Request Access</Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PatientDashboard() {
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ["patient-profile"], queryFn: () => unwrap<any>(api.get("/patients/profile")) });
  const records = useQuery({ queryKey: ["patient-records"], queryFn: () => unwrap<MedicalRecord[]>(api.get("/patients/medical-records")) });
  const requests = useQuery({ queryKey: ["access-requests"], queryFn: () => unwrap<any[]>(api.get("/access/requests")) });
  const permissions = useQuery({ queryKey: ["permissions"], queryFn: () => unwrap<any[]>(api.get("/access/permissions")) });
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: () => unwrap<any[]>(api.get("/notifications")) });
  const approve = useMutation({ mutationFn: (id: string) => unwrap(api.post(`/access/requests/${id}/approve`, { grantedCategories: ["Full medical history", "Prescriptions only", "Diagnostic reports only"], expiresAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString() })), onSuccess: () => void qc.invalidateQueries() });
  const reject = useMutation({ mutationFn: (id: string) => unwrap(api.post(`/access/requests/${id}/reject`)), onSuccess: () => void qc.invalidateQueries() });
  const revoke = useMutation({ mutationFn: (id: string) => unwrap(api.post(`/access/permissions/${id}/revoke`)), onSuccess: () => void qc.invalidateQueries() });
  const verify = useMutation({ mutationFn: (id: string) => unwrap<any>(api.post(`/patients/medical-records/${id}/verify`)), onSuccess: () => void qc.invalidateQueries() });

  const stats = useMemo(() => ({
    healthId: profile.data?.healthId,
    bloodGroup: profile.data?.bloodGroup,
    totalPrescriptions: records.data?.filter((r) => r.recordType === "PRESCRIPTION").length,
    totalReports: records.data?.filter((r) => r.recordType === "LAB_REPORT").length,
    activeAccess: permissions.data?.filter((p) => p.status === "ACTIVE").length,
    verifiedRecords: records.data?.filter((r) => ["ANCHORED", "VERIFIED"].includes(r.blockchainStatus)).length
  }), [profile.data, records.data, permissions.data]);

  return (
    <>
      <section id="overview"><StatsGrid stats={stats} /></section>
      <section id="medical-timeline"><RecordList records={records.data ?? []} onVerify={(id) => verify.mutate(id)} /></section>
      <section id="access-requests" className="grid gap-4 md:grid-cols-2">
        <Card><h2 className="text-xl font-black">Incoming Access Requests</h2><div className="mt-4 space-y-3">{(requests.data ?? []).map((r) => <div key={r.id} className="rounded-lg bg-sky-50 p-3"><div className="font-bold">{r.requester.fullName}</div><div className="text-sm text-slate-600">{r.reason}</div><div className="mt-3 flex gap-2"><Button onClick={() => approve.mutate(r.id)}>Approve</Button><Button onClick={() => reject.mutate(r.id)} className="bg-red-600 hover:bg-red-700">Reject</Button></div></div>)}</div></Card>
        <Card><h2 className="text-xl font-black">Shared Access</h2><div className="mt-4 space-y-3">{(permissions.data ?? []).map((p) => <div key={p.id} className="rounded-lg bg-sky-50 p-3"><div className="font-bold">{p.grantee.fullName}</div><div className="text-sm text-slate-600">{(p.grantedCategories as string[]).join(", ")}</div><Button onClick={() => revoke.mutate(p.id)} className="mt-3 bg-red-600 hover:bg-red-700">Revoke</Button></div>)}</div></Card>
      </section>
      <section id="notifications"><Card><h2 className="mb-4 flex items-center gap-2 text-xl font-black"><Bell />Notifications</h2>{(notifications.data ?? []).map((n) => <div key={n.id} className="border-t border-sky-100 py-3"><div className="font-bold">{n.title}</div><div className="text-sm text-slate-600">{n.message}</div></div>)}</Card></section>
    </>
  );
}

function DoctorDashboard() {
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<PatientSummary | null>(null);
  const dashboard = useQuery({ queryKey: ["doctor-dashboard"], queryFn: () => unwrap<any>(api.get("/doctors/dashboard")) });
  const [query, setQuery] = useState("MCH-2026-000001");
  const patients = useQuery({ queryKey: ["doctor-search", query], queryFn: () => unwrap<PatientSummary[]>(api.get(`/doctors/patients/search?q=${encodeURIComponent(query)}`)), enabled: query.length > 2 });
  const requests = useQuery({ queryKey: ["doctor-requests"], queryFn: () => unwrap<any[]>(api.get("/doctors/access-requests")) });
  const prescriptions = useQuery({ queryKey: ["doctor-prescriptions"], queryFn: () => unwrap<any[]>(api.get("/doctors/prescriptions")) });
  const requestAccess = useMutation({
    mutationFn: (patientId: string) => unwrap(api.post(`/doctors/patients/${patientId}/access-request`, { requestedCategories: ["Full medical history", "Prescriptions only", "Diagnostic reports only"], reason: "Clinical review and treatment", requestedDurationHours: 72 })),
    onSuccess: () => { setMessage("Access request sent. Log in as the patient to approve it."); void qc.invalidateQueries(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Access request failed")
  });
  const createPrescription = useMutation({
    mutationFn: (payload: any) => unwrap(api.post("/doctors/prescriptions", payload)),
    onSuccess: () => { setMessage("Prescription saved. The patient can now see it in their records."); void qc.invalidateQueries(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Prescription creation failed")
  });
  return (
    <>
      <StatusMessage message={message} />
      <StatsGrid stats={dashboard.data ?? {}} />
      <section id="patient-search" className="grid gap-4 lg:grid-cols-2">
        <PatientSearchCard title="Patient Search" query={query} setQuery={setQuery} patients={patients.data ?? []} selectedPatient={selectedPatient} onSelect={setSelectedPatient} onRequestAccess={(patientId) => requestAccess.mutate(patientId)} requesting={requestAccess.isPending} />
        <PrescriptionForm selectedPatient={selectedPatient} onSubmit={(payload) => createPrescription.mutate(payload)} saving={createPrescription.isPending} />
      </section>
      <section id="access-requests"><Card><h2 className="text-xl font-black">My Access Requests</h2>{(requests.data ?? []).map((r) => <div key={r.id} className="border-t border-sky-100 py-3"><b>{r.patient.user.fullName}</b> - {r.status}</div>)}</Card></section>
      <section id="my-consultations"><Card><h2 className="text-xl font-black">Recent Prescriptions</h2>{(prescriptions.data ?? []).map((p) => <div key={p.id} className="border-t border-sky-100 py-3"><b>{p.diagnosis}</b> for {p.patient.user.fullName}</div>)}</Card></section>
    </>
  );
}

function PrescriptionForm({ selectedPatient, onSubmit, saving }: { selectedPatient?: PatientSummary | null; onSubmit: (payload: any) => void; saving?: boolean }) {
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPatient) return;
    const form = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    onSubmit({ patientId: selectedPatient.id, diagnosis: form.diagnosis, notes: form.notes, followUpDate: form.followUpDate, medications: [{ medicineName: form.medicineName, dosage: form.dosage, frequency: form.frequency, duration: form.duration, instructions: form.instructions }] });
  }
  return <Card><h2 className="text-xl font-black">Create Prescription</h2>{!selectedPatient && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-700">Select a patient first. If saving is blocked, ask the patient to approve your access request.</div>}<form onSubmit={submit} className="mt-4 grid gap-3"><Input value={selectedPatient ? `${selectedPatient.user.fullName} (${selectedPatient.healthId})` : ""} readOnly placeholder="Selected patient" /><Input name="diagnosis" placeholder="Diagnosis" required /><Input name="medicineName" placeholder="Medication name" required /><Input name="dosage" placeholder="Dosage" required /><Input name="frequency" placeholder="Frequency" required /><Input name="duration" placeholder="Duration" required /><Input name="followUpDate" type="date" /><Textarea name="instructions" placeholder="Instructions" /><Textarea name="notes" placeholder="Clinical notes" /><Button disabled={!selectedPatient || saving}>{saving ? "Saving..." : "Save Prescription"}</Button></form></Card>;
}

function HospitalDashboard() {
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<PatientSummary | null>(null);
  const [query, setQuery] = useState("MCH-2026-000001");
  const dashboard = useQuery({ queryKey: ["hospital-dashboard"], queryFn: () => unwrap<any>(api.get("/hospitals/dashboard")) });
  const patients = useQuery({ queryKey: ["hospital-search", query], queryFn: () => unwrap<PatientSummary[]>(api.get(`/hospitals/patients/search?q=${encodeURIComponent(query)}`)), enabled: query.length > 2 });
  const requests = useQuery({ queryKey: ["hospital-requests"], queryFn: () => unwrap<any[]>(api.get("/hospitals/access-requests")) });
  const requestAccess = useMutation({
    mutationFn: (patientId: string) => unwrap(api.post(`/hospitals/patients/${patientId}/access-request`, { requestedCategories: ["Full medical history"], reason: "Hospital admission and care documentation", requestedDurationHours: 168 })),
    onSuccess: () => { setMessage("Hospital access request sent. Patient approval is required before saving records."); void qc.invalidateQueries(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Access request failed")
  });
  const createAdmission = useMutation({
    mutationFn: (payload: any) => unwrap(api.post("/hospitals/admissions", payload)),
    onSuccess: () => { setMessage("Admission record saved."); void qc.invalidateQueries(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Record save failed")
  });
  return <><StatusMessage message={message} /><StatsGrid stats={dashboard.data ?? {}} /><section className="grid gap-4 lg:grid-cols-2"><PatientSearchCard title="Patient Search" query={query} setQuery={setQuery} patients={patients.data ?? []} selectedPatient={selectedPatient} onSelect={setSelectedPatient} onRequestAccess={(patientId) => requestAccess.mutate(patientId)} requesting={requestAccess.isPending} /><RecordForm title="Create Admission Record" selectedPatient={selectedPatient} fields={["reason", "ward", "notes"]} onSubmit={(p) => createAdmission.mutate(p)} saving={createAdmission.isPending} /></section><section id="access-requests"><Card><h2 className="text-xl font-black">My Access Requests</h2>{(requests.data ?? []).map((r) => <div key={r.id} className="border-t border-sky-100 py-3"><b>{r.patient.user.fullName}</b> - {r.status}</div>)}</Card></section></>;
}

function LabDashboard() {
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<PatientSummary | null>(null);
  const [query, setQuery] = useState("MCH-2026-000001");
  const dashboard = useQuery({ queryKey: ["lab-dashboard"], queryFn: () => unwrap<any>(api.get("/laboratories/dashboard")) });
  const patients = useQuery({ queryKey: ["lab-search", query], queryFn: () => unwrap<PatientSummary[]>(api.get(`/laboratories/patients/search?q=${encodeURIComponent(query)}`)), enabled: query.length > 2 });
  const requests = useQuery({ queryKey: ["lab-requests"], queryFn: () => unwrap<any[]>(api.get("/laboratories/access-requests")) });
  const reports = useQuery({ queryKey: ["lab-reports"], queryFn: () => unwrap<MedicalRecord[]>(api.get("/laboratories/reports")) });
  const requestAccess = useMutation({
    mutationFn: (patientId: string) => unwrap(api.post(`/laboratories/patients/${patientId}/access-request`, { requestedCategories: ["Diagnostic reports only"], reason: "Diagnostic report upload and verification", requestedDurationHours: 168 })),
    onSuccess: () => { setMessage("Laboratory access request sent. Patient approval is required before uploading reports."); void qc.invalidateQueries(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Access request failed")
  });
  const upload = useMutation({
    mutationFn: (data: FormData) => unwrap(api.post("/laboratories/reports/upload", data, { headers: { "Content-Type": "multipart/form-data" } })),
    onSuccess: () => { setMessage("Report uploaded and saved."); void qc.invalidateQueries(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Report upload failed")
  });
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPatient) {
      setMessage("Select a patient before uploading a report.");
      return;
    }
    const data = new FormData(event.currentTarget);
    data.set("patientId", selectedPatient.id);
    upload.mutate(data);
  }
  return (
    <>
      <StatusMessage message={message} />
      <StatsGrid stats={dashboard.data ?? {}} />
      <section id="patient-search" className="grid gap-4 lg:grid-cols-2"><PatientSearchCard title="Patient Search" query={query} setQuery={setQuery} patients={patients.data ?? []} selectedPatient={selectedPatient} onSelect={setSelectedPatient} onRequestAccess={(patientId) => requestAccess.mutate(patientId)} requesting={requestAccess.isPending} /><Card><h2 className="mb-4 flex items-center gap-2 text-xl font-black"><UploadCloud />Upload Diagnostic Report</h2>{!selectedPatient && <div className="mb-3 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-700">Select a patient first. The patient must approve diagnostic report access.</div>}<form onSubmit={submit} className="grid gap-3 md:grid-cols-2"><Input value={selectedPatient ? `${selectedPatient.user.fullName} (${selectedPatient.healthId})` : ""} readOnly placeholder="Selected patient" /><Select name="category"><option>Blood test</option><option>Pathology</option><option>X-ray</option><option>MRI</option><option>CT scan</option><option>Ultrasound</option><option>Other</option></Select><Input name="title" placeholder="Report title" required /><Input name="testDate" type="date" required /><Input name="file" type="file" accept="application/pdf,image/png,image/jpeg" required /><Textarea name="resultSummary" placeholder="Result summary" /><Button disabled={!selectedPatient || upload.isPending}>{upload.isPending ? "Uploading..." : "Upload and Anchor"}</Button></form></Card></section>
      <section id="access-requests"><Card><h2 className="text-xl font-black">My Access Requests</h2>{(requests.data ?? []).map((r) => <div key={r.id} className="border-t border-sky-100 py-3"><b>{r.patient.user.fullName}</b> - {r.status}</div>)}</Card></section>
      <RecordList records={reports.data ?? []} />
    </>
  );
}

function AdminDashboard() {
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const dashboard = useQuery({ queryKey: ["admin-dashboard"], queryFn: () => unwrap<any>(api.get("/admin/dashboard")) });
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => unwrap<any[]>(api.get("/admin/users")) });
  const records = useQuery({ queryKey: ["admin-records"], queryFn: () => unwrap<any[]>(api.get("/admin/medical-records")) });
  const transactions = useQuery({ queryKey: ["admin-blockchain"], queryFn: () => unwrap<any[]>(api.get("/admin/blockchain-transactions")) });
  const emergencyLogs = useQuery({ queryKey: ["admin-emergency"], queryFn: () => unwrap<any[]>(api.get("/admin/emergency-logs")) });
  const auditLogs = useQuery({ queryKey: ["admin-audit"], queryFn: () => unwrap<any[]>(api.get("/admin/audit-logs")) });
  const accessPermissions = useQuery({ queryKey: ["admin-access-permissions"], queryFn: () => unwrap<any[]>(api.get("/admin/access-permissions")) });
  const verify = useMutation({
    mutationFn: ({ type, id, action }: { type: string; id: string; action: "verify" | "reject" }) => unwrap(api.post(`/admin/${type}/${id}/${action}`)),
    onSuccess: (_data, variables) => { setMessage(`${variables.type.slice(0, -1)} ${variables.action} action completed.`); void qc.invalidateQueries(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Verification action failed")
  });
  const suspend = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => unwrap(api.post(`/admin/users/${id}/suspend`, { isActive })),
    onSuccess: (_data, variables) => { setMessage(variables.isActive ? "User activated." : "User suspended."); void qc.invalidateQueries(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : "User status update failed")
  });
  const chartData = Object.entries(dashboard.data ?? {}).map(([name, value]) => ({ name, value: Number(value) || 0 }));
  const doctors = (users.data ?? []).filter((user) => user.role === "DOCTOR");
  const hospitals = (users.data ?? []).filter((user) => user.role === "HOSPITAL");
  const laboratories = (users.data ?? []).filter((user) => user.role === "LABORATORY");
  return (
    <>
      <StatusMessage message={message} />
      <section id="overview" className="space-y-4">
        <StatsGrid stats={dashboard.data ?? {}} />
        <Card><h2 className="text-xl font-black">System Analytics</h2><div className="h-64"><ResponsiveContainer><AreaChart data={chartData}><XAxis dataKey="name" hide /><Tooltip /><Area dataKey="value" fill="#1689e8" stroke="#096fc7" /></AreaChart></ResponsiveContainer></div></Card>
      </section>

      <section id="users">
        <Card><h2 className="mb-4 text-xl font-black">Users</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="text-slate-500"><th className="py-2">Name</th><th>Role</th><th>Email</th><th>Status</th><th>Action</th></tr></thead><tbody>{(users.data ?? []).map((u) => <tr key={u.id} className="border-t border-sky-100"><td className="py-3 font-bold">{u.fullName}</td><td>{u.role}</td><td>{u.email}</td><td>{u.isActive ? <span className="font-bold text-green-700">Active</span> : <span className="font-bold text-red-700">Suspended</span>}</td><td><Button type="button" onClick={() => suspend.mutate({ id: u.id, isActive: !u.isActive })} className={u.isActive ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"}>{u.isActive ? "Suspend" : "Activate"}</Button></td></tr>)}</tbody></table></div></Card>
      </section>

      <section id="doctor-verification"><VerificationPanel title="Doctor Verification" users={doctors} type="doctors" onAction={verify.mutate} /></section>
      <section id="hospital-verification"><VerificationPanel title="Hospital Verification" users={hospitals} type="hospitals" onAction={verify.mutate} /></section>
      <section id="laboratory-verification"><VerificationPanel title="Laboratory Verification" users={laboratories} type="laboratories" onAction={verify.mutate} /></section>

      <section id="medical-records-monitor">
        <Card><h2 className="mb-4 text-xl font-black">Medical Records Monitor</h2><AdminTable empty="No medical records yet.">{(records.data ?? []).map((record) => <tr key={record.id} className="border-t border-sky-100"><td className="py-3 font-bold">{record.title}</td><td>{record.recordType}</td><td>{record.patient?.healthId}</td><td>{record.creator?.fullName}</td><td><BlockchainStatusBadge status={record.blockchainStatus} /></td></tr>)}</AdminTable></Card>
      </section>

      <section id="blockchain-monitor">
        <Card><h2 className="mb-4 text-xl font-black">Blockchain Monitor</h2><AdminTable empty="No blockchain transactions yet.">{(transactions.data ?? []).map((tx) => <tr key={tx.id} className="border-t border-sky-100"><td className="py-3 font-bold">{tx.transactionType}</td><td>{tx.status}</td><td>{tx.blockNumber ?? "-"}</td><td className="max-w-[240px] truncate">{tx.txHash ?? tx.errorMessage ?? "-"}</td><td>{new Date(tx.createdAt).toLocaleString()}</td></tr>)}</AdminTable></Card>
      </section>

      <section id="emergency-access-audit">
        <Card><h2 className="mb-4 text-xl font-black">Emergency Access Audit</h2><AdminTable empty="No emergency access events.">{(emergencyLogs.data ?? []).map((log) => <tr key={log.id} className="border-t border-sky-100"><td className="py-3 font-bold">{log.requester?.fullName}</td><td>{log.patient?.user?.fullName}</td><td>{log.reason}</td><td>{new Date(log.createdAt).toLocaleString()}</td><td className="max-w-[220px] truncate">{log.blockchainTxHash ?? "-"}</td></tr>)}</AdminTable></Card>
      </section>

      <section id="access-audit-logs" className="grid gap-4 xl:grid-cols-2">
        <Card><h2 className="mb-4 text-xl font-black">Access Permissions</h2><AdminTable empty="No access permissions.">{(accessPermissions.data ?? []).map((permission) => <tr key={permission.id} className="border-t border-sky-100"><td className="py-3 font-bold">{permission.grantee?.fullName}</td><td>{permission.patient?.healthId}</td><td>{permission.status}</td><td>{new Date(permission.expiresAt).toLocaleDateString()}</td><td>{permission.blockchainStatus}</td></tr>)}</AdminTable></Card>
        <Card><h2 className="mb-4 text-xl font-black">Audit Logs</h2><AdminTable empty="No audit logs.">{(auditLogs.data ?? []).map((log) => <tr key={log.id} className="border-t border-sky-100"><td className="py-3 font-bold">{log.action}</td><td>{log.actor?.fullName ?? "System"}</td><td>{log.entityType}</td><td>{new Date(log.createdAt).toLocaleString()}</td><td>{log.ipAddress ?? "-"}</td></tr>)}</AdminTable></Card>
      </section>

      <section id="system-settings">
        <Card><h2 className="mb-4 text-xl font-black">System Settings</h2><div className="grid gap-3 text-sm md:grid-cols-2"><div className="rounded-lg bg-sky-50 p-3"><b>API mode:</b> Live through Vercel proxy</div><div className="rounded-lg bg-sky-50 p-3"><b>Blockchain network:</b> SKALE Base Sepolia</div><div className="rounded-lg bg-sky-50 p-3"><b>Files:</b> Stored off-chain under backend uploads</div><div className="rounded-lg bg-sky-50 p-3"><b>Admin file access:</b> Metadata only, no sensitive file opening</div></div></Card>
      </section>
    </>
  );
}

function AdminTable({ children, empty }: { children: React.ReactNode; empty: string }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children;
  if (Array.isArray(rows) && rows.length === 0) return <div className="rounded-lg bg-sky-50 p-6 text-center font-semibold text-slate-500">{empty}</div>;
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><tbody>{children}</tbody></table></div>;
}

function VerificationPanel({ title, users, type, onAction }: { title: string; users: any[]; type: string; onAction: (input: { type: string; id: string; action: "verify" | "reject" }) => void }) {
  return (
    <Card>
      <h2 className="mb-4 text-xl font-black">{title}</h2>
      <AdminTable empty="No users in this verification queue.">
        {users.map((user) => {
          const profile = user.doctorProfile ?? user.hospitalProfile ?? user.laboratoryProfile;
          return (
            <tr key={user.id} className="border-t border-sky-100">
              <td className="py-3 font-bold">{user.fullName}</td>
              <td>{user.email}</td>
              <td>{profile?.verificationStatus ?? "N/A"}</td>
              <td className="flex flex-wrap gap-2 py-2">
                <Button type="button" onClick={() => onAction({ type, id: profile.id, action: "verify" })} className="bg-green-600 hover:bg-green-700">Verify</Button>
                <Button type="button" onClick={() => onAction({ type, id: profile.id, action: "reject" })} className="bg-red-600 hover:bg-red-700">Reject</Button>
              </td>
            </tr>
          );
        })}
      </AdminTable>
    </Card>
  );
}

function RecordForm({ title, selectedPatient, fields, onSubmit, saving }: { title: string; selectedPatient?: PatientSummary | null; fields: string[]; onSubmit: (payload: any) => void; saving?: boolean }) {
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPatient) return;
    onSubmit({ ...Object.fromEntries(new FormData(event.currentTarget).entries()), patientId: selectedPatient.id });
  }
  return <Card><h2 className="text-xl font-black">{title}</h2>{!selectedPatient && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-700">Select a patient first and make sure access is approved.</div>}<form onSubmit={submit} className="mt-4 grid gap-3 md:grid-cols-2"><Input value={selectedPatient ? `${selectedPatient.user.fullName} (${selectedPatient.healthId})` : ""} readOnly placeholder="Selected patient" />{fields.map((field) => <Input key={field} name={field} placeholder={field} required={field !== "notes"} />)}<Button disabled={!selectedPatient || saving}>{saving ? "Saving..." : "Save Record"}</Button></form></Card>;
}

function RecordList({ records, onVerify }: { records: MedicalRecord[]; onVerify?: (id: string) => void }) {
  return (
    <Card id="blockchain-verification">
      <h2 className="mb-4 flex items-center gap-2 text-xl font-black"><FileCheck2 />Medical Records</h2>
      <div className="space-y-3">
        {records.length === 0 && <div className="rounded-lg bg-sky-50 p-6 text-center font-semibold text-slate-500">No records yet.</div>}
        {records.map((record) => (
          <div key={record.id} className="rounded-lg border border-sky-100 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><div className="font-black">{record.title}</div><div className="text-sm text-slate-500">{record.recordType} - {new Date(record.recordDate).toLocaleDateString()}</div></div>
              <BlockchainStatusBadge status={record.blockchainStatus} />
            </div>
            <div className="mt-3 break-all rounded-lg bg-slate-50 p-3 text-xs text-slate-600">SHA-256: {record.fileHash}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {onVerify && <Button onClick={() => onVerify(record.id)}><ShieldCheck size={16} /> Verify integrity</Button>}
              {record.blockchainTxHash && <a className="rounded-lg bg-sky-50 px-4 py-2 font-bold text-medical-700" href={`${import.meta.env.VITE_SEPOLIA_EXPLORER_BASE_URL}/tx/${record.blockchainTxHash}`} target="_blank" rel="noreferrer">Sepolia explorer</a>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
