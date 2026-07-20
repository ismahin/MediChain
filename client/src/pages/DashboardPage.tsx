import type * as React from "react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Bell, Clock3, FileCheck2, HeartPulse, LogOut, Menu, Search, ShieldCheck, UploadCloud, UserCheck } from "lucide-react";
import { api, unwrap } from "../api/client";
import { useAuth } from "../contexts/AuthContext";
import { useMetaMask, type MetaMaskWallet } from "../hooks/useMetaMask";
import type { MedicalRecord, Role, User } from "../types";
import { BlockchainStatusBadge, Button, Card, Input, SecurityNote, Select, Textarea } from "../components/ui";

type PatientSummary = {
  id: string;
  healthId: string;
  bloodGroup?: string;
  user: Pick<User, "id" | "fullName" | "email">;
  accessStatus?: "NONE" | "PENDING" | "ACTIVE";
};

const nav: Record<Role, string[]> = {
  PATIENT: ["Overview", "Book Appointment", "Care Journey", "My Health Profile", "Medical Timeline", "Prescriptions", "Diagnostic Reports", "Access Requests", "Shared Access", "Blockchain Verification", "Emergency Profile", "Notifications", "Settings"],
  DOCTOR: ["Overview", "Assigned Cases", "Patient Search", "Patient Workspace", "Access Requests", "My Consultations", "Create Consultation", "Create Prescription", "Medical Records", "Blockchain Activity", "Profile & Verification"],
  HOSPITAL: ["Overview", "Appointments", "Diagnostic Orders", "Patient Directory", "Patient Registration", "Admissions", "Discharge Summaries", "Surgery Records", "Medical Documents", "Access Requests", "Staff Doctors", "Blockchain Logs", "Profile"],
  LABORATORY: ["Overview", "Assigned Tests", "Patient Search", "Upload Diagnostic Report", "My Reports", "Verification", "Access Requests", "Blockchain Logs", "Profile"],
  ADMIN: ["Overview", "Users", "Doctor Verification", "Hospital Verification", "Laboratory Verification", "Medical Records Monitor", "Blockchain Monitor", "Emergency Access Audit", "Access Audit Logs", "System Settings"]
};

function slugFor(item: string) {
  return item.toLowerCase().replaceAll("&", "and").replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/(^-|-$)/g, "");
}

export function DashboardPage() {
  const { user, logout } = useAuth();
  const params = useParams();
  const [open, setOpen] = useState(false);
  const wallet = useMetaMask();
  if (!user) return null;
  const defaultSection = slugFor(nav[user.role][0]);
  const section = params.section ?? defaultSection;
  const validSections = nav[user.role].map(slugFor);
  if (!params.section) return <Navigate to={`/dashboard/${defaultSection}`} replace />;
  if (!validSections.includes(section)) return <Navigate to={`/dashboard/${defaultSection}`} replace />;

  return (
    <div className="min-h-screen bg-sky-50">
      {open && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-slate-950/25 backdrop-blur-sm md:hidden" onClick={() => setOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 w-72 overflow-y-auto border-r border-sky-100 bg-white p-5 shadow-xl transition md:translate-x-0 md:shadow-none ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <Link to="/" className="flex items-center gap-2 text-2xl font-black text-medical-700"><HeartPulse />MediChain</Link>
        <div className="mt-6 rounded-lg bg-sky-50 p-4">
          <div className="font-black">{user.fullName}</div>
          <div className="text-sm font-semibold text-medical-700">{user.role}</div>
        </div>
        <nav className="mt-6 space-y-1">{nav[user.role].map((item) => {
          const slug = slugFor(item);
          return <Link key={item} to={`/dashboard/${slug}`} onClick={() => setOpen(false)} className={`block rounded-lg px-3 py-2 text-sm font-semibold ${section === slug ? "bg-medical-600 text-white" : "text-slate-600 hover:bg-sky-50"}`}>{item}</Link>;
        })}</nav>
        <button onClick={logout} className="mt-6 flex items-center gap-2 rounded-lg px-3 py-2 font-bold text-red-600"><LogOut size={18} />Logout</button>
      </aside>

      <main className="md:pl-72">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-sky-100 bg-white/90 px-4 py-3 shadow-sm backdrop-blur md:px-6">
          <button aria-label="Open navigation" onClick={() => setOpen(!open)} className="rounded-lg p-2 text-slate-600 hover:bg-sky-50 md:hidden"><Menu /></button>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-medical-700">MediChain Dashboard</div>
            <h1 className="truncate text-lg font-black text-slate-950 md:text-2xl">{user.role.charAt(0) + user.role.slice(1).toLowerCase()} Workspace</h1>
          </div>
          <div className="flex items-center gap-3">
            {wallet.address ? <span title={wallet.address} className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700"><span className="h-2 w-2 rounded-full bg-emerald-500" />{wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}</span> : <Button onClick={() => void wallet.connect()} className="whitespace-nowrap bg-teal-600 px-3 hover:bg-teal-700">Connect <span className="hidden sm:inline">MetaMask</span></Button>}
          </div>
        </header>

        <div className="space-y-6 p-5">
          <SecurityNote />
          {wallet.error && <div className="rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-700">{wallet.error}</div>}
          {user.role === "PATIENT" && <PatientDashboard section={section} />}
          {user.role === "DOCTOR" && <DoctorDashboard section={section} wallet={wallet} />}
          {user.role === "HOSPITAL" && <HospitalDashboard section={section} wallet={wallet} />}
          {user.role === "LABORATORY" && <LabDashboard section={section} wallet={wallet} />}
          {user.role === "ADMIN" && <AdminDashboard section={section} />}
        </div>
      </main>
    </div>
  );
}

function formatStatValue(value: unknown) {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return 0;
}

async function downloadCaseDocument(document: { id: string; originalFileName: string }) {
  const response = await api.get(`/care/documents/${document.id}/download`, { responseType: "blob" });
  const url = URL.createObjectURL(response.data);
  const link = window.document.createElement("a");
  link.href = url; link.download = document.originalFileName; link.click();
  URL.revokeObjectURL(url);
}

function StatsGrid({ stats }: { stats: Record<string, unknown> }) {
  return <div className="grid gap-4 md:grid-cols-4">{Object.entries(stats).map(([key, value]) => <Card key={key}><div className="text-2xl font-black text-medical-700">{formatStatValue(value)}</div><div className="mt-1 text-sm font-semibold capitalize text-slate-500">{key.replaceAll(/([A-Z])/g, " $1")}</div></Card>)}</div>;
}

function StatusMessage({ message }: { message?: string }) {
  if (!message) return null;
  const normalized = message.toLowerCase();
  const success = !["error", "failed", "not granted", "already exists", "different email", "rejected"].some((term) => normalized.includes(term));
  return <div className={`rounded-lg p-3 text-sm font-semibold ${success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{message}</div>;
}

function StatusPill({ status }: { status?: string }) {
  const normalized = status ?? "PENDING";
  const style = {
    ACTIVE: "bg-green-50 text-green-700",
    APPROVED: "bg-green-50 text-green-700",
    VERIFIED: "bg-green-50 text-green-700",
    PENDING: "bg-amber-50 text-amber-700",
    REJECTED: "bg-red-50 text-red-700",
    REVOKED: "bg-red-50 text-red-700",
    SUSPENDED: "bg-red-50 text-red-700",
    EXPIRED: "bg-slate-100 text-slate-600"
  }[normalized] ?? "bg-sky-50 text-medical-700";
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${style}`}>{normalized}</span>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg bg-sky-50 p-6 text-center font-semibold text-slate-500">{text}</div>;
}

function PageHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-xl font-black">{title}</h2>
      {description && <p className="mt-1 text-sm font-semibold text-slate-500">{description}</p>}
    </div>
  );
}

function AccessRequestsCard({ title, requests }: { title: string; requests: any[] }) {
  return (
    <Card>
      <PageHeading title={title} description="Track requests you sent to patients and wait for approval before creating records." />
      <div className="space-y-3">
        {requests.length === 0 && <EmptyState text="No access requests yet." />}
        {requests.map((request) => (
          <div key={request.id} className="rounded-lg border border-sky-100 p-4">
            <div className="font-bold">{request.patient?.user?.fullName ?? "Patient"}</div>
            <div className="text-sm text-slate-600">{request.reason}</div>
            <div className="mt-2"><StatusPill status={request.status} /></div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ProfileStatusCard({ title, status }: { title: string; status?: string }) {
  return (
    <Card>
      <PageHeading title={title} description="Admin verification controls whether this role can create healthcare records." />
      <div className="rounded-lg bg-sky-50 p-3 font-semibold">Verification status: {status ?? "PENDING"}</div>
    </Card>
  );
}

function PatientSearchCard({
  title,
  query,
  setQuery,
  patients,
  selectedPatient,
  onSelect,
  onRequestAccess,
  requesting,
  loading,
  error
}: {
  title: string;
  query: string;
  setQuery: (value: string) => void;
  patients: PatientSummary[];
  selectedPatient?: PatientSummary | null;
  onSelect: (patient: PatientSummary) => void;
  onRequestAccess: (patientId: string) => void;
  requesting?: boolean;
  loading?: boolean;
  error?: string;
}) {
  return (
    <Card>
      <h2 className="mb-4 flex items-center gap-2 text-xl font-black"><Search />{title}</h2>
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, email, or Health ID" />
      {selectedPatient && <div className="mt-3 rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-700">Selected: {selectedPatient.user.fullName} ({selectedPatient.healthId})</div>}
      <div className="mt-4 space-y-3">
        {loading && <div className="rounded-lg bg-sky-50 p-4 text-center font-semibold text-slate-500">Loading patients...</div>}
        {error && <div className="rounded-lg bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}
        {!loading && !error && patients.length === 0 && <EmptyState text={query ? "No patients match this search." : "No registered patients found."} />}
        {patients.map((patient) => (
          <div key={patient.id} className="rounded-lg bg-sky-50 p-3">
            <div className="font-bold">{patient.user.fullName}</div>
            <div className="text-sm text-slate-600">{patient.healthId}</div>
            <div className="text-sm text-slate-500">{patient.user.email}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" onClick={() => onSelect(patient)} className="bg-teal-600 hover:bg-teal-700">Select Patient</Button>
              {patient.accessStatus === "ACTIVE" ? <span className="inline-flex items-center rounded-lg bg-emerald-100 px-4 py-2 text-sm font-bold text-emerald-700"><UserCheck size={16} className="mr-2" />Access granted</span> : patient.accessStatus === "PENDING" ? <span className="inline-flex items-center rounded-lg bg-amber-100 px-4 py-2 text-sm font-bold text-amber-700"><Clock3 size={16} className="mr-2" />Request pending</span> : <Button type="button" onClick={() => onRequestAccess(patient.id)} disabled={requesting}>Request Access</Button>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PatientDashboard({ section }: { section: string }) {
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ["patient-profile"], queryFn: () => unwrap<any>(api.get("/patients/profile")) });
  const records = useQuery({ queryKey: ["patient-records"], queryFn: () => unwrap<MedicalRecord[]>(api.get("/patients/medical-records")) });
  const requests = useQuery({ queryKey: ["access-requests"], queryFn: () => unwrap<any[]>(api.get("/access/requests")) });
  const permissions = useQuery({ queryKey: ["permissions"], queryFn: () => unwrap<any[]>(api.get("/access/permissions")) });
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: () => unwrap<any[]>(api.get("/notifications")) });
  const careDirectory = useQuery({ queryKey: ["care-directory"], queryFn: () => unwrap<any>(api.get("/care/directory")) });
  const careCases = useQuery({ queryKey: ["patient-care-cases"], queryFn: () => unwrap<any[]>(api.get("/care/cases/mine")) });
  const bookAppointment = useMutation({ mutationFn: (data: FormData) => unwrap(api.post("/care/cases", data, { headers: { "Content-Type": "multipart/form-data" } })), onSuccess: () => void qc.invalidateQueries({ queryKey: ["patient-care-cases"] }) });
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

  const allRecords = records.data ?? [];
  const prescriptionRecords = allRecords.filter((record) => record.recordType === "PRESCRIPTION");
  const reportRecords = allRecords.filter((record) => record.recordType === "LAB_REPORT");
  const blockchainRecords = allRecords.filter((record) => Boolean(record.fileHash || record.metadataHash));
  const accessRequestsView = (
    <Card>
      <PageHeading title="Incoming Access Requests" description="Approve only the access needed for the provider's task. Access expires automatically." />
      <div className="space-y-3">
        {(requests.data ?? []).length === 0 && <EmptyState text="No pending access requests." />}
        {(requests.data ?? []).map((request) => {
          const isPending = request.status === "PENDING";
          const approving = approve.isPending && approve.variables === request.id;
          const rejecting = reject.isPending && reject.variables === request.id;
          return (
            <div key={request.id} className="rounded-lg border border-sky-100 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-bold">{request.requester.fullName}</div>
                  <div className="text-sm text-slate-600">{request.reason}</div>
                </div>
                <StatusPill status={request.status} />
              </div>
              <div className="mt-2 text-xs font-bold text-slate-500">{(request.requestedCategories as string[]).join(", ")}</div>
              {request.reviewedAt && <div className="mt-1 text-xs font-semibold text-slate-500">Reviewed {new Date(request.reviewedAt).toLocaleString()}</div>}
              {isPending ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button onClick={() => approve.mutate(request.id)} disabled={approving || rejecting}>{approving ? "Approving..." : "Approve"}</Button>
                  <Button onClick={() => reject.mutate(request.id)} disabled={approving || rejecting} className="bg-red-600 hover:bg-red-700">{rejecting ? "Rejecting..." : "Reject"}</Button>
                </div>
              ) : (
                <div className="mt-3 rounded-lg bg-sky-50 p-3 text-sm font-semibold text-slate-600">Action completed. This request is now {String(request.status).toLowerCase()}.</div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
  const sharedAccessView = (
    <Card>
      <PageHeading title="Shared Access" description="Revoke active permissions when a provider no longer needs access." />
      <div className="space-y-3">
        {(permissions.data ?? []).length === 0 && <EmptyState text="No active shared access." />}
        {(permissions.data ?? []).map((permission) => {
          const active = permission.status === "ACTIVE" && new Date(permission.expiresAt) > new Date();
          const revoking = revoke.isPending && revoke.variables === permission.id;
          return (
            <div key={permission.id} className="rounded-lg border border-sky-100 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-bold">{permission.grantee.fullName}</div>
                  <div className="text-sm text-slate-600">{(permission.grantedCategories as string[]).join(", ")}</div>
                </div>
                <StatusPill status={active ? permission.status : permission.status === "ACTIVE" ? "EXPIRED" : permission.status} />
              </div>
              <div className="mt-1 text-xs font-semibold text-slate-500">Expires {new Date(permission.expiresAt).toLocaleString()}</div>
              {permission.revokedAt && <div className="mt-1 text-xs font-semibold text-slate-500">Revoked {new Date(permission.revokedAt).toLocaleString()}</div>}
              {active ? (
                <Button onClick={() => revoke.mutate(permission.id)} disabled={revoking} className="mt-3 bg-red-600 hover:bg-red-700">{revoking ? "Revoking..." : "Revoke"}</Button>
              ) : (
                <div className="mt-3 rounded-lg bg-sky-50 p-3 text-sm font-semibold text-slate-600">No further action is available for this permission.</div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );

  if (section === "overview") return <div className="space-y-6"><StatsGrid stats={stats} /><PrescriptionList records={prescriptionRecords.slice(0, 2)} /></div>;
  if (section === "book-appointment") return <BookAppointmentForm directory={careDirectory.data} onSubmit={(data) => bookAppointment.mutate(data)} saving={bookAppointment.isPending} error={bookAppointment.error instanceof Error ? bookAppointment.error.message : undefined} success={bookAppointment.isSuccess} />;
  if (section === "care-journey") return <CareJourney cases={careCases.data ?? []} />;
  if (section === "my-health-profile") return <PatientProfileCard profile={profile.data} />;
  if (section === "medical-timeline") return <RecordList title="Medical Timeline" description="All medical events stored for your health ID." records={allRecords} onVerify={(id) => verify.mutate(id)} />;
  if (section === "prescriptions") return <PrescriptionList records={prescriptionRecords} onVerify={(id) => verify.mutate(id)} />;
  if (section === "diagnostic-reports") return <RecordList title="Diagnostic Reports" description="Laboratory reports uploaded with file integrity hashes." records={reportRecords} empty="No diagnostic reports yet." onVerify={(id) => verify.mutate(id)} />;
  if (section === "blockchain-verification") return <RecordList title="Blockchain Verification" description="Compare local SHA-256 hashes with the anchored blockchain proof." records={blockchainRecords} empty="No records are ready for verification." onVerify={(id) => verify.mutate(id)} />;
  if (section === "access-requests") return accessRequestsView;
  if (section === "shared-access") return sharedAccessView;
  if (section === "emergency-profile") return <EmergencyProfileCard profile={profile.data} />;
  if (section === "notifications") return <Card><h2 className="mb-4 flex items-center gap-2 text-xl font-black"><Bell />Notifications</h2>{(notifications.data ?? []).length === 0 && <EmptyState text="No notifications yet." />}{(notifications.data ?? []).map((n) => <div key={n.id} className="border-t border-sky-100 py-3"><div className="font-bold">{n.title}</div><div className="text-sm text-slate-600">{n.message}</div></div>)}</Card>;
  if (section === "settings") return <PatientSettingsCard profile={profile.data} />;
  return <StatsGrid stats={stats} />;
}

function PatientProfileCard({ profile }: { profile: any }) {
  return <Card><h2 className="mb-4 text-xl font-black">My Health Profile</h2><div className="grid gap-3 md:grid-cols-2">{Object.entries(profile ?? {}).filter(([key]) => !["id", "userId", "createdAt", "updatedAt", "user"].includes(key)).map(([key, value]) => <div key={key} className="rounded-lg bg-sky-50 p-3"><div className="text-xs font-bold uppercase text-slate-500">{key.replaceAll(/([A-Z])/g, " $1")}</div><div className="mt-1 break-words font-semibold">{Array.isArray(value) ? value.join(", ") : typeof value === "object" && value ? JSON.stringify(value) : String(value ?? "-")}</div></div>)}</div></Card>;
}

function EmergencyProfileCard({ profile }: { profile: any }) {
  return <Card><h2 className="mb-4 text-xl font-black">Emergency Profile</h2><div className="grid gap-3 md:grid-cols-2"><div className="rounded-lg bg-sky-50 p-3"><b>Emergency access:</b> {profile?.emergencyAccessEnabled ? "Enabled" : "Disabled"}</div><div className="rounded-lg bg-sky-50 p-3"><b>Blood group:</b> {profile?.bloodGroup ?? "-"}</div><div className="rounded-lg bg-sky-50 p-3"><b>Allergies:</b> {JSON.stringify(profile?.allergies ?? [])}</div><div className="rounded-lg bg-sky-50 p-3"><b>Emergency contact:</b> {profile?.emergencyContactName} {profile?.emergencyContactPhone}</div></div></Card>;
}

function PatientSettingsCard({ profile }: { profile: any }) {
  return (
    <Card>
      <PageHeading title="Settings" description="Clinical profile settings are shown here for review. Sensitive edits should be handled through verified provider workflows." />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg bg-sky-50 p-3"><b>Health ID:</b> {profile?.healthId ?? "-"}</div>
        <div className="rounded-lg bg-sky-50 p-3"><b>Emergency access:</b> {profile?.emergencyAccessEnabled ? "Enabled" : "Disabled"}</div>
        <div className="rounded-lg bg-sky-50 p-3"><b>Blood group:</b> {profile?.bloodGroup ?? "-"}</div>
        <div className="rounded-lg bg-sky-50 p-3"><b>Address:</b> {profile?.address ?? "-"}</div>
      </div>
    </Card>
  );
}

function DoctorDashboard({ section, wallet }: { section: string; wallet: MetaMaskWallet }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [message, setMessage] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<PatientSummary | null>(null);
  const dashboard = useQuery({ queryKey: ["doctor-dashboard"], queryFn: () => unwrap<any>(api.get("/doctors/dashboard")) });
  const [query, setQuery] = useState("MCH-2026-000001");
  const patients = useQuery({ queryKey: ["doctor-search", query], queryFn: () => unwrap<PatientSummary[]>(api.get(`/doctors/patients/search?q=${encodeURIComponent(query)}`)), enabled: query.length > 2 });
  const requests = useQuery({ queryKey: ["doctor-requests"], queryFn: () => unwrap<any[]>(api.get("/doctors/access-requests")) });
  const consultations = useQuery({ queryKey: ["doctor-consultations"], queryFn: () => unwrap<MedicalRecord[]>(api.get("/doctors/consultations")) });
  const prescriptions = useQuery({ queryKey: ["doctor-prescriptions"], queryFn: () => unwrap<any[]>(api.get("/doctors/prescriptions")) });
  const assignedCases = useQuery({ queryKey: ["doctor-assigned-cases"], queryFn: () => unwrap<any[]>(api.get("/care/doctor/cases")) });
  const patientWorkspace = useQuery({ queryKey: ["doctor-patient-workspace", selectedPatient?.id], queryFn: () => unwrap<any>(api.get(`/doctors/patients/${selectedPatient!.id}/workspace`)), enabled: Boolean(selectedPatient?.id && selectedPatient.accessStatus === "ACTIVE") });
  const requestAccess = useMutation({
    mutationFn: (patientId: string) => unwrap(api.post(`/doctors/patients/${patientId}/access-request`, { requestedCategories: ["Full medical history", "Prescriptions only", "Diagnostic reports only"], reason: "Clinical review and treatment", requestedDurationHours: 72 })),
    onSuccess: () => { setMessage("Access request sent. Log in as the patient to approve it."); void qc.invalidateQueries(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Access request failed")
  });
  const createPrescription = useMutation({
    mutationFn: (payload: any) => unwrap(api.post("/doctors/prescriptions", payload)),
    onSuccess: async (record: any) => { setMessage("Prescription saved. Confirming its proof in MetaMask..."); try { const hash = await wallet.anchorRecord(record.id); setMessage(`Prescription anchored successfully (${hash.slice(0, 10)}...).`); } catch (error) { setMessage(`Record saved, but blockchain confirmation failed: ${error instanceof Error ? error.message : "Unknown error"}`); } void qc.invalidateQueries(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Prescription creation failed")
  });
  const createConsultation = useMutation({
    mutationFn: (payload: any) => unwrap<any>(api.post("/doctors/consultations", payload)),
    onSuccess: async (record) => { setMessage("Consultation saved. Confirming its proof in MetaMask..."); try { await wallet.anchorRecord(record.id); setMessage("Consultation saved and anchored on-chain."); } catch (error) { setMessage(`Consultation saved, but blockchain confirmation failed: ${error instanceof Error ? error.message : "Unknown error"}`); } void qc.invalidateQueries(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Consultation creation failed")
  });
  const caseAction = useMutation({ mutationFn: ({ url, payload }: { url: string; payload?: unknown }) => unwrap(api.post(url, payload)), onSuccess: () => { setMessage("Care case updated successfully."); void qc.invalidateQueries(); }, onError: (error) => setMessage(error instanceof Error ? error.message : "Care case action failed") });
  const patientSearch = <PatientSearchCard title="Patient Search" query={query} setQuery={setQuery} patients={patients.data ?? []} selectedPatient={selectedPatient} onSelect={setSelectedPatient} onRequestAccess={(patientId) => requestAccess.mutate(patientId)} requesting={requestAccess.isPending} />;
  const prescriptionRecords = (prescriptions.data ?? []).map((prescription) => prescription.medicalRecord).filter(Boolean) as MedicalRecord[];
  const content =
    section === "overview" ? <StatsGrid stats={dashboard.data ?? {}} /> :
    section === "assigned-cases" ? <DoctorAssignedCases cases={assignedCases.data ?? []} onAction={(url, payload) => caseAction.mutate({ url, payload })} saving={caseAction.isPending} onSelect={(careCase) => { setSelectedPatient({ id: careCase.patient.id, healthId: careCase.patient.healthId, user: careCase.patient.user, accessStatus: careCase.accessStatus }); navigate("/dashboard/patient-workspace"); }} /> :
    section === "patient-search" ? <div className="grid gap-4 xl:grid-cols-2">{patientSearch}<ClinicalWorkflowGuide /></div> :
    section === "patient-workspace" ? <DoctorPatientWorkspace selectedPatient={selectedPatient} data={patientWorkspace.data} loading={patientWorkspace.isLoading} error={patientWorkspace.error instanceof Error ? patientWorkspace.error.message : undefined} /> :
    section === "access-requests" ? <AccessRequestsCard title="My Access Requests" requests={requests.data ?? []} /> :
    section === "my-consultations" ? <RecordList title="My Consultations" description="Consultation records you created after patient approval." records={consultations.data ?? []} empty="No consultations yet." onAnchor={(id) => wallet.anchorRecord(id).then(() => void qc.invalidateQueries())} anchoring={wallet.busy} /> :
    section === "create-consultation" ? <section className="grid gap-4 lg:grid-cols-2">{patientSearch}<RecordForm title="Create Consultation" selectedPatient={selectedPatient} fields={["chiefComplaint", "diagnosis", "notes", "followUpDate"]} onSubmit={(payload) => createConsultation.mutate(payload)} saving={createConsultation.isPending} /></section> :
    section === "create-prescription" ? <section className="grid gap-4 lg:grid-cols-2">{patientSearch}<PrescriptionForm selectedPatient={selectedPatient} onSubmit={(payload) => createPrescription.mutate(payload)} saving={createPrescription.isPending} /></section> :
    section === "medical-records" ? <DoctorMedicalRecordsView consultations={consultations.data ?? []} prescriptions={prescriptionRecords} onAnchor={(id) => wallet.anchorRecord(id).then(() => void qc.invalidateQueries())} anchoring={wallet.busy} /> :
    section === "blockchain-activity" ? <BlockchainTransactionsCard title="Blockchain Activity" transactions={dashboard.data?.transactions ?? []} /> :
    <ProfileStatusCard title="Profile & Verification" status={dashboard.data?.verificationStatus} />;
  return <><StatusMessage message={message} />{content}</>;
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

function DoctorMedicalRecordsView({ consultations, prescriptions, onAnchor, anchoring }: { consultations: MedicalRecord[]; prescriptions: MedicalRecord[]; onAnchor: (id: string) => void; anchoring: boolean }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <RecordList title="Consultation Records" records={consultations} empty="No consultation records yet." onAnchor={onAnchor} anchoring={anchoring} />
      <RecordList title="Prescription Records" records={prescriptions} empty="No prescription records yet." onAnchor={onAnchor} anchoring={anchoring} />
    </div>
  );
}

function BlockchainTransactionsCard({ title, transactions }: { title: string; transactions: any[] }) {
  return (
    <Card>
      <PageHeading title={title} description="Recent wallet-signed blockchain anchoring attempts and confirmations." />
      <div className="space-y-3">
        {transactions.length === 0 && <EmptyState text="No blockchain activity yet." />}
        {transactions.map((tx) => (
          <div key={tx.id} className="rounded-lg border border-sky-100 p-4">
            <div className="font-bold">{tx.transactionType}</div>
            <div className="text-sm text-slate-600">{tx.status} {tx.blockNumber ? `- block ${tx.blockNumber}` : ""}</div>
            <div className="mt-2 break-all rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{tx.txHash ?? tx.errorMessage ?? "Pending"}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function HospitalDashboard({ section, wallet }: { section: string; wallet: MetaMaskWallet }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [message, setMessage] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<PatientSummary | null>(null);
  const [registeredPatient, setRegisteredPatient] = useState<any>(null);
  const [query, setQuery] = useState("");
  const dashboard = useQuery({ queryKey: ["hospital-dashboard"], queryFn: () => unwrap<any>(api.get("/hospitals/dashboard")) });
  const patients = useQuery({ queryKey: ["hospital-search", query], queryFn: () => unwrap<PatientSummary[]>(api.get(`/hospitals/patients/search?q=${encodeURIComponent(query)}`)), enabled: section === "patient-directory" || query.length > 2 });
  const requests = useQuery({ queryKey: ["hospital-requests"], queryFn: () => unwrap<any[]>(api.get("/hospitals/access-requests")) });
  const hospitalRecords = useQuery({ queryKey: ["hospital-records"], queryFn: () => unwrap<MedicalRecord[]>(api.get("/hospitals/records")) });
  const staffDoctors = useQuery({ queryKey: ["hospital-staff-doctors"], queryFn: () => unwrap<any[]>(api.get("/hospitals/staff-doctors")) });
  const appointments = useQuery({ queryKey: ["hospital-care-cases"], queryFn: () => unwrap<any[]>(api.get("/care/hospital/cases")) });
  const availableDoctors = useQuery({ queryKey: ["care-hospital-doctors"], queryFn: () => unwrap<any[]>(api.get("/care/hospital/doctors")) });
  const diagnosticOrders = useQuery({ queryKey: ["hospital-diagnostic-orders"], queryFn: () => unwrap<any[]>(api.get("/care/hospital/diagnostic-orders")) });
  const availableLabs = useQuery({ queryKey: ["care-hospital-labs"], queryFn: () => unwrap<any[]>(api.get("/care/hospital/laboratories")) });
  const requestAccess = useMutation({
    mutationFn: (patientId: string) => unwrap(api.post(`/hospitals/patients/${patientId}/access-request`, { requestedCategories: ["Full medical history"], reason: "Hospital admission and care documentation", requestedDurationHours: 168 })),
    onSuccess: () => { setMessage("Hospital access request sent. Patient approval is required before saving records."); void qc.invalidateQueries(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Access request failed")
  });
  const assignDoctor = useMutation({ mutationFn: ({ caseId, doctorUserId }: any) => unwrap(api.post(`/care/hospital/cases/${caseId}/assign-doctor`, { doctorUserId })), onSuccess: () => { setMessage("Doctor assigned. The doctor will request patient consent before review."); void qc.invalidateQueries(); }, onError: (error) => setMessage(error instanceof Error ? error.message : "Doctor assignment failed") });
  const assignLab = useMutation({ mutationFn: ({ orderId, laboratoryUserId }: any) => unwrap(api.post(`/care/hospital/diagnostic-orders/${orderId}/assign-lab`, { laboratoryUserId })), onSuccess: () => { setMessage("Laboratory assigned to diagnostic order."); void qc.invalidateQueries(); }, onError: (error) => setMessage(error instanceof Error ? error.message : "Laboratory assignment failed") });
  const updateStaff = useMutation({ mutationFn: ({ doctorUserId, add }: { doctorUserId: string; add: boolean }) => add ? unwrap(api.post(`/hospitals/staff-doctors/${doctorUserId}`)) : unwrap(api.delete(`/hospitals/staff-doctors/${doctorUserId}`)), onSuccess: (_data, input) => { setMessage(input.add ? "Doctor added to hospital staff." : "Doctor removed from hospital staff."); void qc.invalidateQueries({ queryKey: ["hospital-staff-doctors"] }); }, onError: (error) => setMessage(error instanceof Error ? error.message : "Staff update failed") });
    const createAdmission = useMutation({
      mutationFn: (payload: any) => unwrap(api.post("/hospitals/admissions", payload)),
      onSuccess: async (record: any) => { setMessage("Record saved. Confirming its proof in MetaMask..."); try { await wallet.anchorRecord(record.id); setMessage("Admission record saved and anchored on-chain."); } catch (error) { setMessage(`Record saved, but blockchain confirmation failed: ${error instanceof Error ? error.message : "Unknown error"}`); } void qc.invalidateQueries(); },
      onError: (error) => setMessage(error instanceof Error ? error.message : "Record save failed")
    });
    const createDischarge = useMutation({
      mutationFn: (payload: any) => unwrap(api.post("/hospitals/discharge-summaries", payload)),
      onSuccess: async (record: any) => { setMessage("Summary saved. Confirming its proof in MetaMask..."); try { await wallet.anchorRecord(record.id); setMessage("Discharge summary saved and anchored on-chain."); } catch (error) { setMessage(`Summary saved, but blockchain confirmation failed: ${error instanceof Error ? error.message : "Unknown error"}`); } void qc.invalidateQueries(); },
      onError: (error) => setMessage(error instanceof Error ? error.message : "Discharge summary failed")
    });
    const createSurgery = useMutation({
      mutationFn: (payload: any) => unwrap(api.post("/hospitals/surgeries", payload)),
      onSuccess: async (record: any) => { setMessage("Record saved. Confirming its proof in MetaMask..."); try { await wallet.anchorRecord(record.id); setMessage("Surgery record saved and anchored on-chain."); } catch (error) { setMessage(`Record saved, but blockchain confirmation failed: ${error instanceof Error ? error.message : "Unknown error"}`); } void qc.invalidateQueries(); },
      onError: (error) => setMessage(error instanceof Error ? error.message : "Surgery record failed")
    });
    const registerPatient = useMutation({
      mutationFn: (payload: any) => unwrap<any>(api.post("/hospitals/patients/register", payload)),
      onSuccess: (data) => { setRegisteredPatient(data); setQuery(data?.patientProfile?.healthId ?? ""); setMessage("Patient registered successfully. Give the login credentials below directly to the patient."); void qc.invalidateQueries(); },
      onError: (error) => setMessage(error instanceof Error ? error.message : "Patient registration failed")
    });
    const patientSearch = <PatientSearchCard title={section === "patient-directory" ? "Patient Directory" : "Patient Search"} query={query} setQuery={setQuery} patients={patients.data ?? []} selectedPatient={selectedPatient} onSelect={setSelectedPatient} onRequestAccess={(patientId) => requestAccess.mutate(patientId)} requesting={requestAccess.isPending} loading={patients.isLoading} error={patients.error instanceof Error ? patients.error.message : undefined} />;
    const activeHospitalMutation = section === "surgery-records" ? createSurgery : section === "discharge-summaries" ? createDischarge : createAdmission;
    const recordForm = <RecordForm title={section === "surgery-records" ? "Create Surgery Record" : section === "discharge-summaries" ? "Create Discharge Summary" : "Create Admission Record"} selectedPatient={selectedPatient} fields={section === "surgery-records" ? ["surgeryName", "surgeon", "notes"] : section === "discharge-summaries" ? ["diagnosis", "summary", "instructions"] : ["reason", "ward", "notes"]} onSubmit={(p) => activeHospitalMutation.mutate(p)} saving={activeHospitalMutation.isPending} />;
  const content =
    section === "overview" ? <StatsGrid stats={dashboard.data ?? {}} /> :
    section === "appointments" ? <HospitalAppointments cases={appointments.data ?? []} doctors={availableDoctors.data ?? []} onAssign={(caseId, doctorUserId) => assignDoctor.mutate({ caseId, doctorUserId })} saving={assignDoctor.isPending} /> :
    section === "diagnostic-orders" ? <HospitalDiagnosticOrders orders={diagnosticOrders.data ?? []} laboratories={availableLabs.data ?? []} onAssign={(orderId, laboratoryUserId) => assignLab.mutate({ orderId, laboratoryUserId })} saving={assignLab.isPending} /> :
    section === "patient-directory" ? patientSearch :
    section === "patient-registration" ? <div className="space-y-4"><HospitalPatientRegistrationForm onSubmit={(payload) => registerPatient.mutate(payload)} saving={registerPatient.isPending} />{registeredPatient && <RegisteredPatientCard patient={registeredPatient} onView={() => { setSelectedPatient({ id: registeredPatient.patientProfile.id, healthId: registeredPatient.patientProfile.healthId, user: { id: registeredPatient.id, fullName: registeredPatient.fullName, email: registeredPatient.email } }); navigate("/dashboard/admissions"); }} />}</div> :
    section === "admissions" || section === "discharge-summaries" || section === "surgery-records" ? <section className="grid gap-4 lg:grid-cols-2">{patientSearch}{recordForm}</section> :
    section === "medical-documents" ? <HospitalDocumentsPage records={hospitalRecords.data ?? []} onAnchor={(id) => wallet.anchorRecord(id).then(() => void qc.invalidateQueries())} anchoring={wallet.busy} /> :
    section === "access-requests" ? <AccessRequestsCard title="My Access Requests" requests={requests.data ?? []} /> :
    section === "staff-doctors" ? <HospitalStaffDoctorsCard doctors={staffDoctors.data ?? []} onUpdate={(doctorUserId, add) => updateStaff.mutate({ doctorUserId, add })} saving={updateStaff.isPending} /> :
    section === "blockchain-logs" ? <BlockchainTransactionsCard title="Blockchain Logs" transactions={dashboard.data?.transactions ?? []} /> :
    <ProfileStatusCard title="Hospital Profile" status={dashboard.data?.verificationStatus} />;
  return <><StatusMessage message={message} />{content}</>;
}

function RegisteredPatientCard({ patient, onView }: { patient: any; onView: () => void }) {
  return (
    <Card className="border-emerald-200 bg-emerald-50/40">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-black uppercase tracking-wider text-emerald-700">Patient account created</div>
          <h3 className="mt-1 text-xl font-black text-slate-950">{patient.fullName}</h3>
          <p className="mt-1 text-sm text-slate-600">The patient signs in using their email address—not their Health ID.</p>
        </div>
        <Button type="button" onClick={onView} className="bg-teal-600 hover:bg-teal-700">Select for records</Button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg bg-white p-3"><div className="text-xs font-bold uppercase text-slate-500">Login email</div><div className="mt-1 break-all font-bold">{patient.email}</div></div>
        <div className="rounded-lg bg-white p-3"><div className="text-xs font-bold uppercase text-slate-500">Temporary password</div><div className="mt-1 font-bold">{patient.temporaryPassword}</div></div>
        <div className="rounded-lg bg-white p-3"><div className="text-xs font-bold uppercase text-slate-500">Health ID</div><div className="mt-1 font-bold">{patient.patientProfile?.healthId}</div></div>
      </div>
      <p className="mt-3 text-xs font-semibold text-amber-700">Share these credentials securely and ask the patient to change the temporary password.</p>
    </Card>
  );
}

function HospitalPatientRegistrationForm({ onSubmit, saving }: { onSubmit: (payload: any) => void; saving?: boolean }) {
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(Object.fromEntries(new FormData(event.currentTarget).entries()));
  }
  return (
    <Card>
      <PageHeading title="Patient Registration" description="Create a patient account and health profile. The backend assigns the Health ID and a temporary demo password." />
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <Input name="fullName" placeholder="Full name" required />
        <Input name="email" type="email" placeholder="Email" required />
        <Input name="phone" placeholder="Phone" />
        <Input name="dateOfBirth" type="date" required />
        <Select name="gender" required><option value="">Gender</option><option>Female</option><option>Male</option><option>Other</option></Select>
        <Input name="nidOrBirthCertificate" placeholder="NID or birth certificate" required />
        <Select name="bloodGroup" required><option value="">Blood group</option><option>A+</option><option>A-</option><option>B+</option><option>B-</option><option>AB+</option><option>AB-</option><option>O+</option><option>O-</option></Select>
        <Input name="emergencyContactName" placeholder="Emergency contact name" required />
        <Input name="emergencyContactPhone" placeholder="Emergency contact phone" required />
        <Textarea name="address" placeholder="Address" required />
        <Button disabled={saving}>{saving ? "Registering..." : "Register Patient"}</Button>
      </form>
    </Card>
  );
}

function HospitalDocumentsPage({ records, onAnchor, anchoring }: { records: MedicalRecord[]; onAnchor: (id: string) => void; anchoring: boolean }) {
  return (
    <div className="space-y-4">
      <RecordList title="Medical Documents" description="Hospital-created admission, discharge, and surgery records with integrity hashes." records={records} empty="No hospital documents created yet." onAnchor={onAnchor} anchoring={anchoring} />
      <div className="grid gap-3 md:grid-cols-3">
        <Link to="/dashboard/admissions" className="rounded-lg bg-sky-50 p-4 font-bold text-medical-700">Create admission record</Link>
        <Link to="/dashboard/discharge-summaries" className="rounded-lg bg-sky-50 p-4 font-bold text-medical-700">Create discharge summary</Link>
        <Link to="/dashboard/surgery-records" className="rounded-lg bg-sky-50 p-4 font-bold text-medical-700">Create surgery record</Link>
      </div>
    </div>
  );
}

function HospitalStaffDoctorsCard({ doctors, onUpdate, saving }: { doctors: any[]; onUpdate: (doctorUserId: string, add: boolean) => void; saving: boolean }) {
  return (
    <Card>
      <PageHeading title="Staff Doctors" description="Build the hospital roster from verified doctors. Staff doctors remain eligible for patient case assignment." />
      <div className="space-y-3">
        {doctors.length === 0 && <EmptyState text="No verified doctors are available. An administrator must verify doctor accounts first." />}
        {doctors.map((doctor) => (
          <div key={doctor.id} className="rounded-lg border border-sky-100 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-bold">{doctor.user?.fullName}</div><div className="text-sm text-slate-600">{doctor.specialization} - {doctor.medicalRegistrationNumber}</div><div className="mt-1 text-xs font-semibold text-slate-500">{doctor.user?.email} · {doctor.organizationName}</div></div><div className="flex items-center gap-2">{doctor.isStaff && <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">On staff</span>}<Button disabled={saving} onClick={() => onUpdate(doctor.userId, !doctor.isStaff)} className={doctor.isStaff ? "bg-red-600 hover:bg-red-700" : "bg-teal-600 hover:bg-teal-700"}>{doctor.isStaff ? "Remove" : "Add to Staff"}</Button></div></div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function LabDashboard({ section, wallet }: { section: string; wallet: MetaMaskWallet }) {
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<PatientSummary | null>(null);
  const [query, setQuery] = useState("MCH-2026-000001");
  const dashboard = useQuery({ queryKey: ["lab-dashboard"], queryFn: () => unwrap<any>(api.get("/laboratories/dashboard")) });
  const patients = useQuery({ queryKey: ["lab-search", query], queryFn: () => unwrap<PatientSummary[]>(api.get(`/laboratories/patients/search?q=${encodeURIComponent(query)}`)), enabled: query.length > 2 });
  const requests = useQuery({ queryKey: ["lab-requests"], queryFn: () => unwrap<any[]>(api.get("/laboratories/access-requests")) });
  const reports = useQuery({ queryKey: ["lab-reports"], queryFn: () => unwrap<MedicalRecord[]>(api.get("/laboratories/reports")) });
  const assignedTests = useQuery({ queryKey: ["laboratory-assigned-tests"], queryFn: () => unwrap<any[]>(api.get("/care/laboratory/orders")) });
  const requestAccess = useMutation({
    mutationFn: (patientId: string) => unwrap(api.post(`/laboratories/patients/${patientId}/access-request`, { requestedCategories: ["Diagnostic reports only"], reason: "Diagnostic report upload and verification", requestedDurationHours: 168 })),
    onSuccess: () => { setMessage("Laboratory access request sent. Patient approval is required before uploading reports."); void qc.invalidateQueries(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Access request failed")
  });
  const upload = useMutation({
    mutationFn: (data: FormData) => unwrap(api.post("/laboratories/reports/upload", data, { headers: { "Content-Type": "multipart/form-data" } })),
    onSuccess: async (record: any) => { setMessage("Report uploaded. Confirming its proof in MetaMask..."); try { await wallet.anchorRecord(record.id); setMessage("Report uploaded and anchored on-chain."); } catch (error) { setMessage(`Report uploaded, but blockchain confirmation failed: ${error instanceof Error ? error.message : "Unknown error"}`); } void qc.invalidateQueries(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Report upload failed")
  });
  const verify = useMutation({
    mutationFn: (id: string) => unwrap<any>(api.post(`/laboratories/reports/${id}/verify`)),
    onSuccess: (_data) => { setMessage("Report hash is available for patient-side blockchain verification."); void qc.invalidateQueries(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Report verification failed")
  });
  const testAction = useMutation({ mutationFn: ({ orderId, data }: { orderId: string; data?: FormData }) => data ? unwrap<any>(api.post(`/care/laboratory/orders/${orderId}/complete`, data, { headers: { "Content-Type": "multipart/form-data" } })) : unwrap<any>(api.post(`/care/laboratory/orders/${orderId}/start`)), onSuccess: async (result) => { if (result?.record?.id) { setMessage("Report delivered. Confirming blockchain proof in MetaMask..."); try { await wallet.anchorRecord(result.record.id); setMessage("Report delivered and anchored on-chain."); } catch (error) { setMessage(`Report delivered, but blockchain anchoring failed: ${error instanceof Error ? error.message : "Unknown error"}`); } } else setMessage("Diagnostic test started."); void qc.invalidateQueries(); }, onError: (error) => setMessage(error instanceof Error ? error.message : "Diagnostic order update failed") });
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
  const patientSearch = <PatientSearchCard title="Patient Search" query={query} setQuery={setQuery} patients={patients.data ?? []} selectedPatient={selectedPatient} onSelect={setSelectedPatient} onRequestAccess={(patientId) => requestAccess.mutate(patientId)} requesting={requestAccess.isPending} />;
  const uploadForm = <Card><h2 className="mb-4 flex items-center gap-2 text-xl font-black"><UploadCloud />Upload Diagnostic Report</h2>{!selectedPatient && <div className="mb-3 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-700">Select a patient first. The patient must approve diagnostic report access.</div>}<form onSubmit={submit} className="grid gap-3 md:grid-cols-2"><Input value={selectedPatient ? `${selectedPatient.user.fullName} (${selectedPatient.healthId})` : ""} readOnly placeholder="Selected patient" /><Select name="category"><option>Blood test</option><option>Pathology</option><option>X-ray</option><option>MRI</option><option>CT scan</option><option>Ultrasound</option><option>Other</option></Select><Input name="title" placeholder="Report title" required /><Input name="testDate" type="date" required /><Input name="file" type="file" accept="application/pdf,image/png,image/jpeg" required /><Textarea name="resultSummary" placeholder="Result summary" /><Button disabled={!selectedPatient || upload.isPending}>{upload.isPending ? "Uploading..." : "Upload and Anchor"}</Button></form></Card>;
  const content =
    section === "overview" ? <StatsGrid stats={dashboard.data ?? {}} /> :
    section === "assigned-tests" ? <LaboratoryAssignedTests orders={assignedTests.data ?? []} onStart={(orderId) => testAction.mutate({ orderId })} onComplete={(orderId, data) => testAction.mutate({ orderId, data })} saving={testAction.isPending} /> :
    section === "patient-search" ? patientSearch :
    section === "upload-diagnostic-report" ? <section className="grid gap-4 lg:grid-cols-2">{patientSearch}{uploadForm}</section> :
    section === "my-reports" ? <RecordList title="My Reports" description="Diagnostic reports uploaded by this laboratory." records={reports.data ?? []} empty="No reports uploaded yet." onAnchor={(id) => wallet.anchorRecord(id).then(() => void qc.invalidateQueries())} anchoring={wallet.busy} /> :
    section === "verification" ? <RecordList title="Verification" description="Review hashes and blockchain status for uploaded diagnostic reports." records={reports.data ?? []} empty="No reports available for verification." onVerify={(id) => verify.mutate(id)} /> :
    section === "access-requests" ? <AccessRequestsCard title="My Access Requests" requests={requests.data ?? []} /> :
    section === "blockchain-logs" ? <RecordList title="Blockchain Logs" description="Anchoring status for laboratory reports." records={reports.data ?? []} empty="No blockchain logs yet." onAnchor={(id) => wallet.anchorRecord(id).then(() => void qc.invalidateQueries())} anchoring={wallet.busy} /> :
    <ProfileStatusCard title="Laboratory Profile" status={dashboard.data?.verificationStatus} />;
  return <><StatusMessage message={message} />{content}</>;
}

function AdminDashboard({ section }: { section: string }) {
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
    const overviewView = <div className="space-y-4"><StatsGrid stats={dashboard.data ?? {}} /><Card><h2 className="text-xl font-black">System Analytics</h2><div className="h-64"><ResponsiveContainer><AreaChart data={chartData}><XAxis dataKey="name" hide /><Tooltip /><Area dataKey="value" fill="#1689e8" stroke="#096fc7" /></AreaChart></ResponsiveContainer></div></Card></div>;
    const usersView = <Card><h2 className="mb-4 text-xl font-black">Users</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="text-slate-500"><th className="py-2">Name</th><th>Role</th><th>Email</th><th>Status</th><th>Action</th></tr></thead><tbody>{(users.data ?? []).map((u) => <tr key={u.id} className="border-t border-sky-100"><td className="py-3 font-bold">{u.fullName}</td><td>{u.role}</td><td>{u.email}</td><td>{u.isActive ? <span className="font-bold text-green-700">Active</span> : <span className="font-bold text-red-700">Suspended</span>}</td><td><Button type="button" onClick={() => suspend.mutate({ id: u.id, isActive: !u.isActive })} disabled={suspend.isPending} className={u.isActive ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"}>{u.isActive ? "Suspend" : "Activate"}</Button></td></tr>)}</tbody></table></div></Card>;
    const recordsView = <Card><h2 className="mb-4 text-xl font-black">Medical Records Monitor</h2><AdminTable empty="No medical records yet.">{(records.data ?? []).map((record) => <tr key={record.id} className="border-t border-sky-100"><td className="py-3 font-bold">{record.title}</td><td>{record.recordType}</td><td>{record.patient?.healthId}</td><td>{record.creator?.fullName}</td><td><BlockchainStatusBadge status={record.blockchainStatus} /></td></tr>)}</AdminTable></Card>;
    const blockchainView = <Card><h2 className="mb-4 text-xl font-black">Blockchain Monitor</h2><AdminTable empty="No blockchain transactions yet.">{(transactions.data ?? []).map((tx) => <tr key={tx.id} className="border-t border-sky-100"><td className="py-3 font-bold">{tx.transactionType}</td><td>{tx.status}</td><td>{tx.blockNumber ?? "-"}</td><td className="max-w-[240px] truncate">{tx.txHash ?? tx.errorMessage ?? "-"}</td><td>{new Date(tx.createdAt).toLocaleString()}</td></tr>)}</AdminTable></Card>;
    const emergencyView = <Card><h2 className="mb-4 text-xl font-black">Emergency Access Audit</h2><AdminTable empty="No emergency access events.">{(emergencyLogs.data ?? []).map((log) => <tr key={log.id} className="border-t border-sky-100"><td className="py-3 font-bold">{log.requester?.fullName}</td><td>{log.patient?.user?.fullName}</td><td>{log.reason}</td><td>{new Date(log.createdAt).toLocaleString()}</td><td className="max-w-[220px] truncate">{log.blockchainTxHash ?? "-"}</td></tr>)}</AdminTable></Card>;
    const auditView = <div className="grid gap-4 xl:grid-cols-2"><Card><h2 className="mb-4 text-xl font-black">Access Permissions</h2><AdminTable empty="No access permissions.">{(accessPermissions.data ?? []).map((permission) => <tr key={permission.id} className="border-t border-sky-100"><td className="py-3 font-bold">{permission.grantee?.fullName}</td><td>{permission.patient?.healthId}</td><td>{permission.status}</td><td>{new Date(permission.expiresAt).toLocaleDateString()}</td><td>{permission.blockchainStatus}</td></tr>)}</AdminTable></Card><Card><h2 className="mb-4 text-xl font-black">Audit Logs</h2><AdminTable empty="No audit logs.">{(auditLogs.data ?? []).map((log) => <tr key={log.id} className="border-t border-sky-100"><td className="py-3 font-bold">{log.action}</td><td>{log.actor?.fullName ?? "System"}</td><td>{log.entityType}</td><td>{new Date(log.createdAt).toLocaleString()}</td><td>{log.ipAddress ?? "-"}</td></tr>)}</AdminTable></Card></div>;
    const settingsView = <Card><h2 className="mb-4 text-xl font-black">System Settings</h2><div className="grid gap-3 text-sm md:grid-cols-2"><div className="rounded-lg bg-sky-50 p-3"><b>API mode:</b> Live through Vercel proxy</div><div className="rounded-lg bg-sky-50 p-3"><b>Blockchain network:</b> SKALE Base Sepolia</div><div className="rounded-lg bg-sky-50 p-3"><b>Files:</b> Stored off-chain under backend uploads</div><div className="rounded-lg bg-sky-50 p-3"><b>Admin file access:</b> Metadata only, no sensitive file opening</div></div></Card>;
    const content =
      section === "overview" ? overviewView :
      section === "users" ? usersView :
      section === "doctor-verification" ? <VerificationPanel title="Doctor Verification" users={doctors} type="doctors" onAction={verify.mutate} pendingAction={verify.variables} /> :
      section === "hospital-verification" ? <VerificationPanel title="Hospital Verification" users={hospitals} type="hospitals" onAction={verify.mutate} pendingAction={verify.variables} /> :
      section === "laboratory-verification" ? <VerificationPanel title="Laboratory Verification" users={laboratories} type="laboratories" onAction={verify.mutate} pendingAction={verify.variables} /> :
      section === "medical-records-monitor" ? recordsView :
      section === "blockchain-monitor" ? blockchainView :
      section === "emergency-access-audit" ? emergencyView :
      section === "access-audit-logs" ? auditView :
      settingsView;
    return <><StatusMessage message={message} />{content}</>;
  }

function AdminTable({ children, empty }: { children: React.ReactNode; empty: string }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children;
  if (Array.isArray(rows) && rows.length === 0) return <div className="rounded-lg bg-sky-50 p-6 text-center font-semibold text-slate-500">{empty}</div>;
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><tbody>{children}</tbody></table></div>;
}

function VerificationPanel({
  title,
  users,
  type,
  onAction,
  pendingAction
}: {
  title: string;
  users: any[];
  type: string;
  onAction: (input: { type: string; id: string; action: "verify" | "reject" }) => void;
  pendingAction?: { type: string; id: string; action: "verify" | "reject" };
}) {
  return (
    <Card>
      <h2 className="mb-4 text-xl font-black">{title}</h2>
      <AdminTable empty="No users in this verification queue.">
        {users.map((user) => {
          const profile = user.doctorProfile ?? user.hospitalProfile ?? user.laboratoryProfile;
          const status = profile?.verificationStatus ?? "N/A";
          const pending = pendingAction?.id === profile?.id;
          return (
            <tr key={user.id} className="border-t border-sky-100">
              <td className="py-3 font-bold">{user.fullName}</td>
              <td>{user.email}</td>
              <td><StatusPill status={status} /></td>
              <td className="flex flex-wrap gap-2 py-2">
                {status === "PENDING" ? (
                  <>
                    <Button type="button" onClick={() => onAction({ type, id: profile.id, action: "verify" })} disabled={pending} className="bg-green-600 hover:bg-green-700">{pending && pendingAction?.action === "verify" ? "Verifying..." : "Verify"}</Button>
                    <Button type="button" onClick={() => onAction({ type, id: profile.id, action: "reject" })} disabled={pending} className="bg-red-600 hover:bg-red-700">{pending && pendingAction?.action === "reject" ? "Rejecting..." : "Reject"}</Button>
                  </>
                ) : (
                  <span className="rounded-lg bg-sky-50 px-3 py-2 text-sm font-semibold text-slate-600">No action needed</span>
                )}
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

function BookAppointmentForm({ directory, onSubmit, saving, error, success }: { directory?: any; onSubmit: (data: FormData) => void; saving: boolean; error?: string; success: boolean }) {
  function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }
  return <Card><PageHeading title="Book an Appointment" description="Describe your problem, choose a hospital and preferred doctor, and attach up to five previous reports." />{success && <div className="mb-4 rounded-lg bg-emerald-50 p-3 font-semibold text-emerald-700">Appointment submitted. Track hospital and doctor actions in Care Journey.</div>}{error && <div className="mb-4 rounded-lg bg-red-50 p-3 font-semibold text-red-700">{error}</div>}<form onSubmit={submit} className="grid gap-4 md:grid-cols-2"><label className="text-sm font-bold">Problem title<Input name="problemTitle" placeholder="e.g. Persistent chest pain" required /></label><label className="text-sm font-bold">Preferred appointment<Input name="appointmentDate" type="datetime-local" required /></label><label className="text-sm font-bold">Hospital<Select name="hospitalUserId" required><option value="">Select verified hospital</option>{(directory?.hospitals ?? []).map((item: any) => <option key={item.id} value={item.id}>{item.hospitalProfile?.hospitalName ?? item.fullName}</option>)}</Select></label><label className="text-sm font-bold">Preferred doctor (optional)<Select name="preferredDoctorUserId"><option value="">Hospital may assign a doctor</option>{(directory?.doctors ?? []).map((item: any) => <option key={item.id} value={item.id}>{item.fullName} — {item.doctorProfile?.specialization}</option>)}</Select></label><label className="text-sm font-bold md:col-span-2">Problem details<Textarea name="problemDetails" rows={5} placeholder="Symptoms, duration, severity, previous treatment, and anything the clinical team should know" required /></label><label className="text-sm font-bold md:col-span-2">Previous documents<Input name="documents" type="file" accept="application/pdf,image/png,image/jpeg" multiple /></label><Button disabled={saving} className="md:col-span-2">{saving ? "Submitting appointment..." : "Submit Appointment"}</Button></form></Card>;
}

function CareJourney({ cases }: { cases: any[] }) {
  return <div className="space-y-4"><PageHeading title="Care Journey" description="Follow each appointment from hospital review through consultation, tests, reports, and follow-up." />{cases.length === 0 && <Card><EmptyState text="No appointments submitted yet." /></Card>}{cases.map((item) => <Card key={item.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-black">{item.problemTitle}</h3><div className="text-sm text-slate-500">Appointment {new Date(item.appointmentDate).toLocaleString()}</div></div><StatusPill status={item.status} /></div><p className="mt-3 text-slate-700">{item.problemDetails}</p><div className="mt-4 grid gap-3 md:grid-cols-3"><ClinicalField label="Hospital" value={item.hospital?.fullName ?? "Awaiting hospital"} /><ClinicalField label="Assigned doctor" value={item.assignedDoctor?.fullName ?? "Not assigned"} /><ClinicalField label="Previous documents" value={`${item.documents?.length ?? 0} attached`} /></div>{item.diagnosticOrders?.length > 0 && <div className="mt-4"><div className="mb-2 font-black">Diagnostic tests</div>{item.diagnosticOrders.map((order: any) => <div key={order.id} className="mb-2 rounded-lg bg-sky-50 p-3"><div className="flex justify-between gap-3"><b>{order.testName}</b><StatusPill status={order.status} /></div><div className="text-sm text-slate-600">Laboratory: {order.laboratory?.fullName ?? "Awaiting hospital assignment"}</div></div>)}</div>}{item.followUpDate && <div className="mt-3 font-bold text-medical-700">Next follow-up: {new Date(item.followUpDate).toLocaleString()}</div>}</Card>)}</div>;
}

function HospitalAppointments({ cases, doctors, onAssign, saving }: { cases: any[]; doctors: any[]; onAssign: (caseId: string, doctorId: string) => void; saving: boolean }) {
  return <div className="space-y-4"><PageHeading title="Appointment Queue" description="Review patient problems and previous documents, then assign the appropriate doctor." />{cases.length === 0 && <Card><EmptyState text="No patient appointments waiting." /></Card>}{cases.map((item) => <Card key={item.id}><div className="flex flex-wrap justify-between gap-3"><div><h3 className="text-xl font-black">{item.patient?.user?.fullName} — {item.problemTitle}</h3><div className="text-sm text-slate-500">{item.patient?.healthId} · {new Date(item.appointmentDate).toLocaleString()}</div></div><StatusPill status={item.status} /></div><p className="mt-3">{item.problemDetails}</p><div className="mt-2 text-sm font-semibold text-slate-600">Preferred doctor: {item.preferredDoctor?.fullName ?? "No preference"}</div>{item.documents?.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{item.documents.map((document: any) => <Button key={document.id} type="button" className="bg-slate-600 hover:bg-slate-700" onClick={() => void downloadCaseDocument(document)}>Open {document.originalFileName}</Button>)}</div>}<form className="mt-4 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); const doctorId = String(new FormData(event.currentTarget).get("doctorUserId") ?? ""); if (doctorId) onAssign(item.id, doctorId); }}><Select name="doctorUserId" required><option value="">Select doctor</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.fullName} — {doctor.doctorProfile?.specialization}</option>)}</Select><Button disabled={saving}>{item.assignedDoctorUserId ? "Reassign Doctor" : "Assign Doctor"}</Button></form></Card>)}</div>;
}

function HospitalDiagnosticOrders({ orders, laboratories, onAssign, saving }: { orders: any[]; laboratories: any[]; onAssign: (orderId: string, labId: string) => void; saving: boolean }) {
  return <div className="space-y-4"><PageHeading title="Diagnostic Order Queue" description="Assign doctor-requested tests to a verified laboratory." />{orders.length === 0 && <Card><EmptyState text="No diagnostic orders received." /></Card>}{orders.map((order) => <Card key={order.id}><div className="flex justify-between gap-3"><div><h3 className="text-xl font-black">{order.testName}</h3><div className="text-sm text-slate-500">Patient: {order.careCase?.patient?.user?.fullName} · Doctor: {order.doctor?.fullName}</div></div><StatusPill status={order.status} /></div><p className="mt-3">{order.clinicalReason}</p>{order.status !== "COMPLETED" && <form className="mt-4 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); const labId = String(new FormData(event.currentTarget).get("laboratoryUserId") ?? ""); if (labId) onAssign(order.id, labId); }}><Select name="laboratoryUserId" required className="max-w-md"><option value="">Select laboratory</option>{laboratories.map((lab) => <option key={lab.id} value={lab.id}>{lab.laboratoryProfile?.laboratoryName ?? lab.fullName}</option>)}</Select><Button disabled={saving}>Assign Laboratory</Button></form>}</Card>)}</div>;
}

function DoctorAssignedCases({ cases, onAction, saving, onSelect }: { cases: any[]; onAction: (url: string, payload?: unknown) => void; saving: boolean; onSelect: (item: any) => void }) {
  return <div className="space-y-4"><PageHeading title="Assigned Patient Cases" description="Request consent, review the patient, start sessions, order tests, and manage follow-ups." />{cases.length === 0 && <Card><EmptyState text="No cases assigned by a hospital." /></Card>}{cases.map((item) => <Card key={item.id}><div className="flex flex-wrap justify-between gap-3"><div><h3 className="text-xl font-black">{item.patient?.user?.fullName} — {item.problemTitle}</h3><div className="text-sm text-slate-500">{item.patient?.healthId} · {new Date(item.appointmentDate).toLocaleString()}</div></div><div className="flex gap-2"><StatusPill status={item.status} /><StatusPill status={item.accessStatus} /></div></div><p className="mt-3">{item.problemDetails}</p><div className="mt-4 flex flex-wrap gap-2">{item.accessStatus === "NONE" && <Button disabled={saving} onClick={() => onAction(`/care/doctor/cases/${item.id}/request-access`)}>Request Patient Access</Button>}{item.accessStatus === "PENDING" && <span className="rounded-lg bg-amber-50 px-4 py-2 font-bold text-amber-700">Waiting for consent</span>}{item.accessStatus === "ACTIVE" && <><Button onClick={() => { onSelect(item); onAction(`/care/doctor/cases/${item.id}/start`); }}>Start / Resume Session</Button><Button onClick={() => onSelect(item)} className="bg-teal-600 hover:bg-teal-700">Load Patient Profile</Button></>}</div>{item.accessStatus === "ACTIVE" && <div className="mt-5 grid gap-4 lg:grid-cols-2"><form className="rounded-xl border border-sky-100 p-4" onSubmit={(event) => { event.preventDefault(); onAction(`/care/doctor/cases/${item.id}/diagnostic-orders`, Object.fromEntries(new FormData(event.currentTarget))); }}><h4 className="mb-3 font-black">Order diagnostic test</h4><div className="space-y-2"><Input name="testName" placeholder="Test name (CBC, MRI, X-ray...)" required /><Textarea name="clinicalReason" placeholder="Clinical reason" required /><Textarea name="instructions" placeholder="Lab instructions" /><Button disabled={saving}>Send to Hospital</Button></div></form><form className="rounded-xl border border-sky-100 p-4" onSubmit={(event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); onAction(`/care/doctor/cases/${item.id}/follow-up`, { ...values, completed: values.completed === "true" }); }}><h4 className="mb-3 font-black">Follow-up / completion</h4><div className="space-y-2"><Textarea name="doctorNotes" placeholder="Clinical outcome and follow-up notes" required /><Input name="followUpDate" type="datetime-local" /><Select name="completed"><option value="false">Schedule follow-up</option><option value="true">Complete care case</option></Select><Button disabled={saving}>Save Care Plan</Button></div></form></div>}</Card>)}</div>;
}

function LaboratoryAssignedTests({ orders, onStart, onComplete, saving }: { orders: any[]; onStart: (id: string) => void; onComplete: (id: string, data: FormData) => void; saving: boolean }) {
  return <div className="space-y-4"><PageHeading title="Assigned Diagnostic Tests" description="Perform hospital-assigned tests and deliver the completed report to the patient and doctor." />{orders.length === 0 && <Card><EmptyState text="No tests assigned to this laboratory." /></Card>}{orders.map((order) => <Card key={order.id}><div className="flex justify-between gap-3"><div><h3 className="text-xl font-black">{order.testName}</h3><div className="text-sm text-slate-500">Patient: {order.careCase?.patient?.user?.fullName} · Doctor: {order.doctor?.fullName}</div></div><StatusPill status={order.status} /></div><p className="mt-3">{order.clinicalReason}</p>{order.instructions && <div className="mt-2 rounded-lg bg-sky-50 p-3 text-sm">Instructions: {order.instructions}</div>}{order.status === "LAB_ASSIGNED" && <Button className="mt-4" disabled={saving} onClick={() => onStart(order.id)}>Start Test</Button>}{order.status === "IN_PROGRESS" && <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); onComplete(order.id, new FormData(event.currentTarget)); }}><Textarea name="resultSummary" placeholder="Result summary" required /><Input name="file" type="file" accept="application/pdf,image/png,image/jpeg" required /><Button disabled={saving} className="md:col-span-2">Complete and Deliver Report</Button></form>}</Card>)}</div>;
}

function ClinicalWorkflowGuide() {
  return <Card><PageHeading title="Clinical workflow" description="Patient consent controls what a provider can view and create." /><ol className="space-y-3 text-sm text-slate-700"><li className="rounded-lg bg-sky-50 p-3"><b>1. Find and select the patient.</b><br />Search by Health ID. If access is unavailable, send one request.</li><li className="rounded-lg bg-sky-50 p-3"><b>2. Wait for patient approval.</b><br />The patient approves categories and duration from their dashboard.</li><li className="rounded-lg bg-sky-50 p-3"><b>3. Open Patient Workspace.</b><br />Review the clinical summary and existing records after access is active.</li><li className="rounded-lg bg-sky-50 p-3"><b>4. Document care.</b><br />Doctors create consultations and prescriptions. Laboratories upload diagnostic test reports.</li></ol></Card>;
}

function DoctorPatientWorkspace({ selectedPatient, data, loading, error }: { selectedPatient: PatientSummary | null; data?: any; loading: boolean; error?: string }) {
  if (!selectedPatient) return <Card><PageHeading title="Patient Workspace" description="Select a patient from Patient Search first." /><EmptyState text="No patient selected." /></Card>;
  if (selectedPatient.accessStatus !== "ACTIVE") return <Card><PageHeading title="Patient Workspace" description="Patient consent is required." /><div className="rounded-lg bg-amber-50 p-4 font-semibold text-amber-700">Access is {selectedPatient.accessStatus === "PENDING" ? "waiting for patient approval" : "not granted"}.</div></Card>;
  if (loading) return <Card><EmptyState text="Loading clinical workspace..." /></Card>;
  if (error) return <Card><div className="rounded-lg bg-red-50 p-4 font-semibold text-red-700">{error}</div></Card>;
  const patient = data?.patient;
  const records = (data?.records ?? []) as MedicalRecord[];
  return <div className="space-y-4"><Card><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-xs font-black uppercase tracking-wider text-medical-700">{patient?.healthId}</div><h2 className="text-2xl font-black">{patient?.user?.fullName}</h2><p className="text-sm text-slate-500">{patient?.gender} · {patient?.bloodGroup ?? "Blood group unavailable"} · Born {patient?.dateOfBirth ? new Date(patient.dateOfBirth).toLocaleDateString() : "-"}</p></div><div className="flex flex-wrap gap-2"><Link to="/dashboard/create-consultation" className="rounded-lg bg-medical-600 px-4 py-2 font-bold text-white">New consultation</Link><Link to="/dashboard/create-prescription" className="rounded-lg bg-teal-600 px-4 py-2 font-bold text-white">New prescription</Link></div></div><div className="mt-4 grid gap-3 md:grid-cols-3"><ClinicalField label="Allergies" value={patient?.allergies} /><ClinicalField label="Chronic conditions" value={patient?.chronicConditions} /><ClinicalField label="Current medications" value={patient?.currentMedications} /></div></Card><RecordList title="Clinical Timeline" description="Consultations, prescriptions, diagnostic reports, and hospital records." records={records} /></div>;
}

function ClinicalField({ label, value }: { label: string; value: unknown }) {
  const display = Array.isArray(value) ? (value.length ? value.join(", ") : "None recorded") : String(value ?? "None recorded");
  return <div className="rounded-lg bg-sky-50 p-3"><div className="text-xs font-bold uppercase text-slate-500">{label}</div><div className="mt-1 font-semibold">{display}</div></div>;
}

function PrescriptionList({ records, onVerify }: { records: MedicalRecord[]; onVerify?: (id: string) => void }) {
  return <div className="space-y-4"><PageHeading title="My Prescriptions" description="Medication plans issued by your doctors, with dosage and follow-up instructions." />{records.length === 0 && <Card><EmptyState text="No prescriptions have been issued yet." /></Card>}{records.map((record) => <Card key={record.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-black uppercase tracking-wider text-medical-700">{new Date(record.recordDate).toLocaleDateString()}</div><h3 className="text-xl font-black">{record.prescription?.diagnosis ?? record.title}</h3><p className="text-sm text-slate-500">Prescribed by {record.creator?.fullName ?? "Verified doctor"}</p></div><BlockchainStatusBadge status={record.blockchainStatus} /></div><div className="mt-4 space-y-3">{(record.prescription?.medications ?? []).map((medicine) => <div key={medicine.id} className="rounded-xl border border-sky-100 bg-sky-50/60 p-4"><div className="font-black text-slate-950">{medicine.medicineName}</div><div className="mt-2 grid gap-2 text-sm sm:grid-cols-3"><div><span className="text-slate-500">Dosage:</span> <b>{medicine.dosage}</b></div><div><span className="text-slate-500">Frequency:</span> <b>{medicine.frequency}</b></div><div><span className="text-slate-500">Duration:</span> <b>{medicine.duration}</b></div></div>{medicine.instructions && <div className="mt-2 text-sm text-slate-600">Instructions: {medicine.instructions}</div>}</div>)}</div>{record.prescription?.notes && <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><b>Doctor’s notes:</b> {record.prescription.notes}</div>}{record.prescription?.followUpDate && <div className="mt-3 text-sm font-bold text-medical-700">Follow-up: {new Date(record.prescription.followUpDate).toLocaleDateString()}</div>}{onVerify && <Button onClick={() => onVerify(record.id)} className="mt-4"><ShieldCheck size={16} />Verify blockchain proof</Button>}</Card>)}</div>;
}

function RecordList({ title = "Medical Records", description, records, empty = "No records yet.", onVerify, onAnchor, anchoring }: { title?: string; description?: string; records: MedicalRecord[]; empty?: string; onVerify?: (id: string) => void; onAnchor?: (id: string) => void; anchoring?: boolean }) {
  const explorerBase = import.meta.env.VITE_SEPOLIA_EXPLORER_BASE_URL || "https://base-sepolia-testnet-explorer.skalenodes.com";
  return (
    <Card id="blockchain-verification">
      <div className="mb-4 flex items-start gap-2">
        <FileCheck2 className="mt-1 shrink-0" />
        <PageHeading title={title} description={description} />
      </div>
      <div className="space-y-3">
        {records.length === 0 && <EmptyState text={empty} />}
        {records.map((record) => (
          <div key={record.id} className="rounded-lg border border-sky-100 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><div className="font-black">{record.title}</div><div className="text-sm text-slate-500">{record.recordType} - {new Date(record.recordDate).toLocaleDateString()}</div></div>
              <BlockchainStatusBadge status={record.blockchainStatus} />
            </div>
            <div className="mt-3 break-all rounded-lg bg-slate-50 p-3 text-xs text-slate-600">SHA-256: {record.fileHash}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {onAnchor && !["ANCHORED", "VERIFIED"].includes(record.blockchainStatus) && <Button onClick={() => onAnchor(record.id)} disabled={anchoring}><ShieldCheck size={16} />{anchoring ? "Waiting for MetaMask..." : "Anchor with MetaMask"}</Button>}
              {onVerify && record.blockchainStatus !== "VERIFIED" && <Button onClick={() => onVerify(record.id)}><ShieldCheck size={16} /> Verify integrity</Button>}
              {onVerify && record.blockchainStatus === "VERIFIED" && <span className="inline-flex items-center gap-1 rounded-lg bg-green-50 px-4 py-2 font-bold text-green-700"><ShieldCheck size={16} /> Integrity verified</span>}
              {record.blockchainTxHash && <a className="rounded-lg bg-sky-50 px-4 py-2 font-bold text-medical-700" href={`${explorerBase}/tx/${record.blockchainTxHash}`} target="_blank" rel="noreferrer">Open explorer</a>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
