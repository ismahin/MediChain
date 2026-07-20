import type * as React from "react";
import { AlertCircle, CheckCircle2, Clock3, RefreshCw, ShieldCheck } from "lucide-react";
import type { MedicalRecord } from "../types";

export function Button({ className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`inline-flex items-center justify-center gap-2 rounded-lg bg-medical-600 px-4 py-2 font-semibold text-white shadow-soft transition hover:-translate-y-0.5 hover:bg-medical-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-medical-200 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 ${className}`} {...props} />;
}

export function Card({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-xl border border-sky-100 bg-white p-5 shadow-soft ${className}`} {...props} />;
}

export function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`w-full rounded-lg border border-sky-100 bg-white px-3 py-2 outline-none ring-medical-100 transition focus:ring-4 ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`w-full rounded-lg border border-sky-100 bg-white px-3 py-2 outline-none ring-medical-100 transition focus:ring-4 ${className}`} {...props} />;
}

export function Textarea({ className = "", ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`w-full rounded-lg border border-sky-100 bg-white px-3 py-2 outline-none ring-medical-100 transition focus:ring-4 ${className}`} {...props} />;
}

export function BlockchainStatusBadge({ status }: { status: MedicalRecord["blockchainStatus"] | string }) {
  const style = {
    PENDING: "bg-amber-50 text-amber-700",
    ANCHORED: "bg-emerald-50 text-emerald-700",
    VERIFIED: "bg-green-50 text-green-700",
    FAILED: "bg-red-50 text-red-700",
    RETRYING: "bg-blue-50 text-blue-700"
  }[status] ?? "bg-slate-50 text-slate-700";
  const Icon = status === "FAILED" ? AlertCircle : status === "PENDING" ? Clock3 : status === "RETRYING" ? RefreshCw : CheckCircle2;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}><Icon size={14} />{status}</span>;
}

export function SecurityNote() {
  return (
    <div className="rounded-lg border border-teal-100 bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800">
      <ShieldCheck className="mr-2 inline" size={16} />
      Stored securely off-chain; integrity and ownership proof anchored on blockchain.
    </div>
  );
}
