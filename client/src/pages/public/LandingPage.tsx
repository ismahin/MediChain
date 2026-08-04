import { motion } from "framer-motion";
import { Activity, Database, FileCheck2, HeartPulse, LockKeyhole, ShieldCheck, Stethoscope, UserCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, Card, SecurityNote } from "../../components/ui";
import { useSystemConfig } from "../../contexts/SystemConfigContext";

const features = ["Unique Digital Health ID", "Medical History Timeline", "Consent-Based Record Sharing", "Doctor Digital Prescription", "Lab Report Verification", "Blockchain Proof & Audit Logs", "Emergency Medical Access", "Secure Document Storage"];
const roles = ["Patient", "Doctor", "Hospital", "Laboratory", "Administrator"];

export function LandingPage() {
  const { config } = useSystemConfig();
  const appName = config?.appName ?? "Healthcare Portal";
  const networkName = config?.blockchain.configured ? config.blockchain.networkName : "the configured blockchain network";
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-sky-50 to-white">
      <nav className="sticky top-0 z-30 border-b border-sky-100 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <Link to="/" className="flex items-center gap-2 text-xl font-black text-medical-700"><HeartPulse className="text-teal-500" />{appName}</Link>
          <div className="hidden items-center gap-6 text-sm font-semibold text-slate-600 md:flex">
            {["Features", "How It Works", "Security", "User Roles", "Contact"].map((item) => <a key={item} href={`#${item.toLowerCase().replaceAll(" ", "-")}`}>{item}</a>)}
          </div>
          <div className="flex gap-2">
            <Link to="/login" className="rounded-lg px-4 py-2 font-semibold text-medical-700">Login</Link>
            <Link to="/register"><Button>Get Started</Button></Link>
          </div>
        </div>
      </nav>

      <section className="relative overflow-hidden px-5 py-20">
        <div className="absolute left-10 top-20 h-48 w-48 rounded-full bg-teal-200/40 blur-3xl" />
        <div className="absolute right-10 top-36 h-64 w-64 rounded-full bg-purple-200/40 blur-3xl" />
        <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <div className="mb-5 inline-flex rounded-full bg-sky-100 px-4 py-2 text-sm font-bold text-medical-700">Blockchain-Based Lifelong Digital Health Record System</div>
            <h1 className="max-w-4xl text-4xl font-black leading-tight text-slate-950 md:text-6xl">Your Health Records. Secure, Verified, and Always Under Your Control.</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">MediChain securely connects patients, doctors, hospitals, and laboratories through blockchain-backed medical records.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register"><Button className="px-6 py-3">Create Health ID</Button></Link>
              <a href="#features" className="rounded-lg border border-sky-200 bg-white px-6 py-3 font-bold text-medical-700 shadow-sm">Explore the Platform</a>
            </div>
            <div className="mt-6 max-w-xl"><SecurityNote /></div>
          </motion.div>
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="relative min-h-[430px]">
            {[
              ["Prescription", FileCheck2, "bg-blue-50", "left-4 top-8"],
              ["Lab Report", Activity, "bg-teal-50", "right-4 top-20"],
              ["Consent Granted", UserCheck, "bg-green-50", "left-12 bottom-24"],
              ["Verified on Blockchain", ShieldCheck, "bg-purple-50", "right-0 bottom-10"]
            ].map(([label, Icon, color, pos], index) => {
              const TypedIcon = Icon as typeof FileCheck2;
              return (
                <motion.div key={label as string} animate={{ y: [0, -12, 0] }} transition={{ repeat: Infinity, duration: 4 + index, ease: "easeInOut" }} className={`glass absolute ${pos} w-64 rounded-lg p-5 shadow-soft`}>
                  <div className={`mb-4 grid h-12 w-12 place-items-center rounded-lg ${color}`}><TypedIcon className="text-medical-600" /></div>
                  <div className="font-black text-slate-900">{label as string}</div>
                  <div className="mt-2 text-sm text-slate-500">Secure proof synced with patient consent.</div>
                </motion.div>
              );
            })}
            <div className="absolute inset-16 rounded-full border border-dashed border-sky-200" />
          </motion.div>
        </div>
      </section>

      <section className="px-5 py-12">
        <div className="mx-auto grid max-w-7xl gap-4 md:grid-cols-4">
          {["Patient-Controlled Access", "Tamper-Evident Health Records", "Role-Based Security", "Blockchain Verification"].map((capability) => (
            <Card key={capability}><ShieldCheck className="text-medical-600" /><div className="mt-3 text-sm font-semibold text-slate-600">{capability}</div></Card>
          ))}
        </div>
      </section>

      <section id="features" className="px-5 py-16">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-3xl font-black text-slate-950">Main Features</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-4">
            {features.map((feature) => <Card key={feature}><Stethoscope className="mb-4 text-teal-500" /><div className="font-bold">{feature}</div></Card>)}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="px-5 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-black text-slate-950">How It Works</h2>
          <div className="mt-8 space-y-4">
            {["Patient creates Health ID", "Doctor requests access", "Patient approves through dashboard", "Doctor adds prescription or treatment record", `Hash and audit proof are anchored on ${networkName}`, "Patient sees complete verified timeline"].map((step, index) => (
              <div key={step} className="flex gap-4 rounded-lg bg-white p-4 shadow-sm"><span className="grid h-9 w-9 place-items-center rounded-full bg-medical-600 font-black text-white">{index + 1}</span><span className="pt-1 font-semibold">{step}</span></div>
            ))}
          </div>
        </div>
      </section>

      <section id="user-roles" className="px-5 py-16">
        <div className="mx-auto grid max-w-7xl gap-4 md:grid-cols-5">{roles.map((role) => <Card key={role} className="text-center"><UserCheck className="mx-auto mb-3 text-medical-600" /><div className="font-black">{role}</div></Card>)}</div>
      </section>

      <section id="security" className="px-5 py-16">
        <div className="mx-auto max-w-7xl rounded-2xl bg-gradient-to-r from-medical-600 to-teal-500 p-8 text-white shadow-soft">
          <LockKeyhole size={36} />
          <h2 className="mt-4 text-3xl font-black">Security Model</h2>
          <p className="mt-4 max-w-4xl text-white/90">Files use {config?.uploads.storage ?? "server-managed off-chain storage"}, while SHA-256 document hashes and audit proof metadata are anchored on {networkName}. Passwords are bcrypt-hashed, APIs use JWT authentication, and backend role/consent checks protect every sensitive route.</p>
        </div>
      </section>

      <footer id="contact" className="border-t border-sky-100 px-5 py-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 text-sm text-slate-500 md:flex-row md:items-center md:justify-between">
          <div className="font-black text-medical-700">{appName}</div>
          <div>{config?.demoMode ? "Demo healthcare platform - not for emergency medical decisions." : "Not for emergency medical decisions."}</div>
          <div>© {new Date().getFullYear()} {appName}</div>
        </div>
      </footer>
    </div>
  );
}
