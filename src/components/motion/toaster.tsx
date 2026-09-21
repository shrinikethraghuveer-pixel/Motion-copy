"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toast: (t: { kind?: ToastKind; title: string; description?: string }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const KIND_STYLE: Record<ToastKind, { icon: typeof Info; ring: string; iconColor: string }> = {
  success: {
    icon: CheckCircle2,
    ring: "border-emerald-500/30 bg-emerald-500/10",
    iconColor: "text-emerald-400",
  },
  error: {
    icon: AlertTriangle,
    ring: "border-rose-500/30 bg-rose-500/10",
    iconColor: "text-rose-400",
  },
  info: {
    icon: Info,
    ring: "border-violet-500/30 bg-violet-500/10",
    iconColor: "text-violet-400",
  },
};

/** Global toaster: mount once in the root layout, call `useToast()` anywhere. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback<ToastContextValue["toast"]>(
    ({ kind = "info", title, description }) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev.slice(-4), { id, kind, title, description }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), 4500)
      );
    },
    [dismiss]
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* toast viewport */}
      <div className="pointer-events-none fixed bottom-20 left-1/2 z-[70] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4 sm:bottom-6 sm:left-auto sm:right-6 sm:translate-x-0">
        {toasts.map((t) => {
          const style = KIND_STYLE[t.kind];
          const Icon = style.icon;
          return (
            <div
              key={t.id}
              role="status"
              className="toast-item pointer-events-auto flex items-start gap-3 rounded-xl border border-white/10 bg-zinc-950/80 px-4 py-3 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] backdrop-blur-xl"
            >
              <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full", style.ring)}>
                <Icon size={13} className={style.iconColor} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-100">{t.title}</p>
                {t.description && (
                  <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">{t.description}</p>
                )}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="rounded-md p-1 text-zinc-500 transition hover:text-zinc-200"
                aria-label="Dismiss notification"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) return { toast: () => undefined }; // safe no-op outside the provider
  return ctx;
}
