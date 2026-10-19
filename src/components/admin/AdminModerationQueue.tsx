"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, ShieldAlert } from "lucide-react";

type Report = {
  id: string;
  targetType: "user" | "post";
  targetId: string;
  reason: string;
  status: string;
  createdAt: string;
  reporter: string;
  target: null | { handle: string; name: string; userId: string; text?: string; mediaUrl?: string | null; bannerUrl?: string | null };
};
type Action = "dismiss" | "remove_media" | "remove_content" | "suspend_user" | "delete_user";

export default function AdminModerationQueue() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/reports", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load reports.");
      setReports(data.reports ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load reports."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const act = async (report: Report, action: Action) => {
    const actionLabels: Record<Action, string> = {
      dismiss: "Dismiss this report?",
      remove_media: "Remove the reported profile or post media?",
      remove_content: "Permanently remove this reported post?",
      suspend_user: `Suspend @${report.target?.handle ?? "this user"} for 30 days?`,
      delete_user: `Permanently delete @${report.target?.handle ?? "this user"}? This cannot be undone.`,
    };
    if (!window.confirm(actionLabels[action])) return;
    setBusyId(report.id); setError("");
    try {
      const response = await fetch("/api/admin/reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId: report.id, action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Moderation action failed.");
      setReports((current) => current.filter((item) => item.id !== report.id));
    } catch (e) { setError(e instanceof Error ? e.message : "Moderation action failed."); }
    finally { setBusyId(null); }
  };

  if (loading) return <div className="flex items-center gap-2 py-12 text-sm text-zinc-400"><Loader2 size={17} className="animate-spin" />Loading reports…</div>;

  return <div>
    <div className="mb-4 flex items-center justify-between"><p className="text-sm text-zinc-400">{reports.length} pending {reports.length === 1 ? "report" : "reports"}</p><button onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800"><RefreshCw size={14} />Refresh</button></div>
    {error && <p role="alert" className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
    {reports.length === 0 ? <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-10 text-center"><ShieldAlert className="mx-auto text-emerald-400" size={26} /><p className="mt-3 font-medium">No pending reports</p><p className="mt-1 text-sm text-zinc-500">New reports will appear here.</p></div> : <div className="space-y-4">{reports.map((report) => <article key={report.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-amber-400">{report.targetType} report</p><h2 className="mt-1 font-semibold">{report.target ? `${report.target.name} (@${report.target.handle})` : "Content unavailable"}</h2><p className="mt-1 text-xs text-zinc-500">Reported by @{report.reporter} · {new Date(report.createdAt).toLocaleString()}</p></div><span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300">Pending</span></div>
      <p className="mt-4 rounded-lg bg-black/20 p-3 text-sm text-zinc-300"><b className="text-zinc-100">Reason:</b> {report.reason}</p>
      {report.target?.text && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-zinc-300">{report.target.text}</p>}
      {(report.target?.mediaUrl || report.target?.bannerUrl) && <div className="mt-3 flex flex-wrap gap-3">{[report.target.mediaUrl, report.target.bannerUrl].filter((url): url is string => !!url).map((url) => /^https:\/\//i.test(url) ? <a key={url} href={url} target="_blank" rel="noreferrer" className="text-xs text-violet-300 underline">Open reported media</a> : <span key={url} className="text-xs text-zinc-500 break-all">{url}</span>)}</div>}
      <div className="mt-5 flex flex-wrap gap-2">
        <button disabled={busyId === report.id} onClick={() => void act(report, "dismiss")} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs hover:bg-zinc-800 disabled:opacity-50">Dismiss</button>
        {(report.target?.mediaUrl || report.target?.bannerUrl) && <button disabled={busyId === report.id} onClick={() => void act(report, "remove_media")} className="rounded-lg border border-amber-500/40 px-3 py-2 text-xs text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">Remove media</button>}
        {report.targetType === "post" && <button disabled={busyId === report.id} onClick={() => void act(report, "remove_content")} className="rounded-lg border border-red-500/40 px-3 py-2 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50">Remove post</button>}
        {report.target?.userId && <><button disabled={busyId === report.id} onClick={() => void act(report, "suspend_user")} className="rounded-lg border border-orange-500/40 px-3 py-2 text-xs text-orange-300 hover:bg-orange-500/10 disabled:opacity-50">Suspend account</button><button disabled={busyId === report.id} onClick={() => void act(report, "delete_user")} className="rounded-lg bg-red-700 px-3 py-2 text-xs text-white hover:bg-red-600 disabled:opacity-50">Delete account</button></>}
        {busyId === report.id && <span className="self-center text-xs text-zinc-400">Processing…</span>}
      </div>
    </article>)}</div>}
  </div>;
}
