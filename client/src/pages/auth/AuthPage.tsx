import type * as React from "react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { HeartPulse } from "lucide-react";
import { api, unwrap } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import type { Role, User } from "../../types";
import { Button, Card, Input, Select, SecurityNote } from "../../components/ui";
import { useSystemConfig } from "../../contexts/SystemConfigContext";

const roles: Role[] = ["PATIENT", "DOCTOR", "HOSPITAL", "LABORATORY", "ADMIN"];
const registrationRoles: Role[] = ["PATIENT", "DOCTOR", "HOSPITAL", "LABORATORY"];
export function AuthPage({ mode = "login" }: { mode?: "login" | "register" }) {
  const navigate = useNavigate();
  const { login, refresh } = useAuth();
  const { config } = useSystemConfig();
  const [role, setRole] = useState<Role>("PATIENT");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (mode === "register" && role === "ADMIN") setRole("PATIENT");
  }, [mode, role]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const form = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    try {
      if (mode === "login") {
        await login(form.email, form.password, role);
      } else {
        const endpoint = role.toLowerCase();
        const payload = buildRegistrationPayload(role, form);
        const result = await unwrap<{ user: User; accessToken: string; refreshToken: string }>(api.post(`/auth/register/${endpoint}`, payload));
        localStorage.setItem("medichain_access_token", result.accessToken);
        localStorage.setItem("medichain_refresh_token", result.refreshToken);
        await refresh();
      }
      navigate("/dashboard");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed. Check API server and validation fields.");
    } finally {
      setLoading(false);
    }
  }

  function fill(email: string, password: string, nextRole: Role) {
    setRole(nextRole);
    const emailInput = document.querySelector<HTMLInputElement>("input[name=email]");
    const passwordInput = document.querySelector<HTMLInputElement>("input[name=password]");
    if (emailInput) emailInput.value = email;
    if (passwordInput) passwordInput.value = password;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-sky-50 to-teal-50 px-5 py-10">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="pt-10">
          <Link to="/" className="flex items-center gap-2 text-2xl font-black text-medical-700"><HeartPulse />{config?.appName ?? "Healthcare Portal"}</Link>
          <h1 className="mt-10 text-4xl font-black text-slate-950">{mode === "login" ? "Welcome back to your secure health workspace." : "Create a verified MediChain account."}</h1>
          <p className="mt-5 text-lg leading-8 text-slate-600">Role-specific authentication, patient consent, and blockchain-backed integrity proofs are enforced by the backend.</p>
          <div className="mt-6"><SecurityNote /></div>
          {mode === "login" && config?.demoMode && config.demoAccounts.length > 0 && (
            <Card className="mt-6">
              <div className="font-black">Demo accounts</div>
              <div className="mt-3 grid gap-2">
                {config.demoAccounts.map(({ email, password, role: accountRole }) => (
                  <button key={email} type="button" onClick={() => fill(email, password, accountRole)} className="rounded-lg bg-sky-50 px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-sky-100">{accountRole}: {email}</button>
                ))}
              </div>
            </Card>
          )}
        </div>

        <Card className="p-6 md:p-8">
          <div className="mb-6 flex gap-2">
            <Link className={`rounded-lg px-4 py-2 font-bold ${mode === "login" ? "bg-medical-600 text-white" : "bg-sky-50 text-medical-700"}`} to="/login">Login</Link>
            <Link className={`rounded-lg px-4 py-2 font-bold ${mode === "register" ? "bg-medical-600 text-white" : "bg-sky-50 text-medical-700"}`} to="/register">Register</Link>
          </div>
          <form onSubmit={submit} className="grid gap-4">
            <label className="text-sm font-bold">Role<Select value={role} onChange={(event) => setRole(event.target.value as Role)}>{(mode === "register" ? registrationRoles : roles).map((item) => <option key={item}>{item}</option>)}</Select></label>
            <label className="text-sm font-bold">Email<Input name="email" type="email" required /></label>
            <label className="text-sm font-bold">Password<Input name="password" type="password" required minLength={8} /></label>

            {mode === "register" && (
              <>
                <label className="text-sm font-bold">{role === "HOSPITAL" ? "Hospital name" : role === "LABORATORY" ? "Lab name" : "Full name"}<Input name="fullName" required /></label>
                <label className="text-sm font-bold">Confirm password<Input name="confirmPassword" type="password" required minLength={8} /></label>
                <label className="text-sm font-bold">Phone<Input name="phone" /></label>
                <label className="text-sm font-bold">Wallet address<Input name="walletAddress" placeholder="Optional MetaMask address" /></label>
                {role === "PATIENT" && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <Input name="dateOfBirth" type="date" required />
                    <Input name="gender" placeholder="Gender" required />
                    <Input name="nidOrBirthCertificate" placeholder="NID or Birth Certificate" required />
                    <Input name="bloodGroup" placeholder="Blood group" required />
                    <Input name="emergencyContactName" placeholder="Emergency contact name" required />
                    <Input name="emergencyContactPhone" placeholder="Emergency contact phone" required />
                    <Input name="address" placeholder="Address" required />
                  </div>
                )}
                {role === "DOCTOR" && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <Input name="medicalRegistrationNumber" placeholder="Medical registration number" required />
                    <Input name="specialization" placeholder="Specialization" required />
                    <Input name="organizationName" placeholder="Hospital/clinic name" required />
                  </div>
                )}
                {(role === "HOSPITAL" || role === "LABORATORY") && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <Input name="licenseNumber" placeholder="License number" required />
                    <Input name="address" placeholder="Address" required />
                  </div>
                )}
              </>
            )}

            {message && <div className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{message}</div>}
            <Button disabled={loading}>{loading ? "Please wait..." : mode === "login" ? "Login" : "Create account"}</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

function buildRegistrationPayload(role: Role, form: Record<string, string>) {
  const base = {
    fullName: form.fullName,
    email: form.email,
    password: form.password,
    confirmPassword: form.confirmPassword,
    phone: form.phone,
    walletAddress: form.walletAddress
  };
  if (role === "PATIENT") {
    z.object({ dateOfBirth: z.string(), gender: z.string(), nidOrBirthCertificate: z.string(), bloodGroup: z.string(), emergencyContactName: z.string(), emergencyContactPhone: z.string(), address: z.string() }).parse(form);
    return { ...base, dateOfBirth: form.dateOfBirth, gender: form.gender, nidOrBirthCertificate: form.nidOrBirthCertificate, bloodGroup: form.bloodGroup, emergencyContactName: form.emergencyContactName, emergencyContactPhone: form.emergencyContactPhone, address: form.address };
  }
  if (role === "DOCTOR") return { ...base, medicalRegistrationNumber: form.medicalRegistrationNumber, specialization: form.specialization, organizationName: form.organizationName };
  return { ...base, licenseNumber: form.licenseNumber, address: form.address };
}
