"use client";

import Link from "next/link";
import { useEffect } from "react";
import { BadgeCheck, X } from "lucide-react";
import { gradientFor, initialsOf } from "@/lib/utils";

export function GoldMLogo({ size = 34 }: { size?: number }) {
  return (
    <span
      className="font-display inline-flex select-none items-center justify-center rounded-xl font-bold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.58,
        background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 55%, #d97706 100%)",
        color: "#0b1329",
        boxShadow: "0 0 18px rgba(251, 191, 36, 0.35)",
      }}
    >
      M
    </span>
  );
}

export function Avatar({
  user,
  size = 44,
  ring = false,
}: {
  user: { id: string; name: string; ageTag?: string; photo?: string | null };
  size?: number;
  ring?: boolean;
}) {
  const inner = user.photo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={user.photo}
      alt={user.name}
      className="aspect-square shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    (() => {
      const { from, to } = gradientFor(user.id);
      return (
        <span
          className="flex items-center justify-center rounded-full font-semibold"
          style={{
            width: size,
            height: size,
            fontSize: size * 0.38,
            background: `linear-gradient(135deg, hsl(${from} 70% 55%), hsl(${to} 70% 45%))`,
            color: "#0b1329",
          }}
        >
          {initialsOf(user.name)}
        </span>
      );
    })()
  );
  if (!ring) return inner;
  return (
    <span className="rounded-full p-[2.5px]" style={{ background: "linear-gradient(135deg, #fbbf24, #38bdf8)" }}>
      <span className="block rounded-full bg-canvas p-[2px]">{inner}</span>
    </span>
  );
}

/** iOS-style toggle used across Settings. Optimistic — caller decides whether to persist. */
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200 ${
        checked ? "border-ice/50 bg-gradient-to-r from-gold/50 to-ice/50" : "border-edge bg-card2"
      }`}
    >
      <span
        className="absolute top-[2px] block rounded-full border border-black/10 bg-white shadow transition-all duration-200"
        style={{ left: checked ? 22 : 2, width: 18, height: 18 }}
      />
    </button>
  );
}

/** Mini liquid-glass segmented selector for 2–4 options. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="liquid-track !p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`relative rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
            value === o.value
              ? "bg-gradient-to-br from-gold/30 to-ice/25 text-ink shadow-[0_0_10px_rgba(251,191,36,0.2)]"
              : "text-mist hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "gold" | "ice" | "coral" }) {
  const tones: Record<string, string> = {
    default: "border-edge bg-card2/70 text-mist",
    gold: "border-gold/30 bg-gold-soft text-gold",
    ice: "border-ice/30 bg-ice-soft text-ice",
    coral: "border-coral/30 bg-coral/10 text-coral",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

export function PulseBadge({ label = "Pulse" }: { label?: string }) {
  return (
    <span className="pulse-badge-ring inline-flex items-center">
      <span className="inline-flex items-center gap-1 rounded-full bg-canvas/85 px-2 py-0.5 text-[11px] font-bold">
        <BadgeCheck size={12} className="pulse-badge" />
        <span className="pulse-badge uppercase tracking-wide">{label}</span>
      </span>
    </span>
  );
}

export function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="glass-soft flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="text-gold/70">{icon}</div>
      <p className="font-display font-semibold">{title}</p>
      {hint && <p className="max-w-xs text-sm text-mist">{hint}</p>}
    </div>
  );
}

export function Modal({
  children,
  onClose,
  wide = false,
}: {
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-canvas/80 backdrop-blur-sm" onClick={onClose} />
      <div className={`glass scale-in relative z-10 max-h-[88vh] w-full overflow-y-auto p-6 ${wide ? "max-w-2xl" : "max-w-md"}`}>{children}</div>
    </div>
  );
}

export function XButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-full border border-edge bg-card/60 p-1.5 text-mist transition hover:text-ink" aria-label="Close">
      <X size={16} />
    </button>
  );
}

export { Link };
