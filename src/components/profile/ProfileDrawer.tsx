"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api, type ProfilePayload } from "@/lib/client";
import ProfileHeaderCard from "@/components/profile/ProfileHeaderCard";

export default function ProfileDrawer({ handle, onClose }: { handle: string; onClose: () => void }) {
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<ProfilePayload>(`/api/users/${handle}`)
      .then((d) => live && setData(d))
      .catch((e) => live && setErr(e instanceof Error ? e.message : "Failed to load"));
    return () => {
      live = false;
    };
  }, [handle]);

  return (
    <div className="fixed inset-0 z-[85]">
      <div className="absolute inset-0 bg-canvas/70 backdrop-blur-sm" onClick={onClose} />
      <div className="glass scale-in absolute right-4 top-4 bottom-4 w-[420px] max-w-[92vw] overflow-y-auto p-0">
        {err && <div className="p-6 text-sm text-coral">{err}</div>}
        {!data && !err && <div className="p-6 text-sm text-mist">Loading profile…</div>}
        {data && (
          <div className="relative">
            <button onClick={onClose} className="absolute right-4 top-4 z-10 rounded-full border border-edge bg-canvas/70 p-1.5 text-mist hover:text-ink" aria-label="Close">
              <X size={16} />
            </button>
            <ProfileHeaderCard data={data} compact />
          </div>
        )}
      </div>
    </div>
  );
}
