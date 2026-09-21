"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { useToast } from "@/components/motion/toaster";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface AiAssistantProps {
  open: boolean;
  onClose: () => void;
  /** Prompt auto-sent when the drawer opens (hero quick-actions). */
  seed?: string | null;
}

export function AiAssistant({ open, onClose, seed }: AiAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hey! I'm Motion's assistant. Ask me for post ideas, a sharper bio, collab outreach drafts, or event copy.",
    },
  ]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  const { toast } = useToast();

  // Auto-send seeded prompts from quick-action triggers (once per seed).
  const seedSentRef = useRef<string | null>(null);
  useEffect(() => {
    if (open && seed && !streaming && seedSentRef.current !== seed) {
      seedSentRef.current = seed;
      void handleSend(seed);
    }
    if (!open) seedSentRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seed]);

  async function handleSend(directPrompt?: string) {
    const prompt = (directPrompt ?? input).trim();
    if (!prompt || streaming) return;
    setInput("");
    const history = [...messages, { role: "user" as const, content: prompt }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/ai/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          context: history
            .slice(-4, -1)
            .map((m) => `${m.role}: ${m.content}`)
            .join("\n"),
        }),
        signal: controller.signal,
      });

      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        const data = await res.json().catch(() => ({ error: "AI request failed." }));
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: data.error ?? "AI request failed." };
          return next;
        });
        toast({ kind: "error", title: "AI request failed", description: data.error ?? undefined });
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      while (!done) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") {
            done = true;
            break;
          }
          try {
            const { token } = JSON.parse(payload) as { token?: string };
            if (token) {
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                next[next.length - 1] = { ...last, content: last.content + token };
                return next;
              });
            }
          } catch {
            /* ignore malformed chunk */
          }
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: "Connection hiccup — try again." };
          return next;
        });
        toast({ kind: "error", title: "Connection hiccup", description: "The AI stream dropped — try again." });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  // Minimal, safe rendering: escape HTML, then bold **text** and `code`.
  function renderMarkdown(text: string): string {
    return escapeHtml(text)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, '<code class="rounded bg-zinc-800 px-1 py-0.5 text-[12px]">$1</code>');
  }

  return (
    <div
      className={cn(
        "fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-slate-300/80 bg-slate-100/95 text-zinc-900 shadow-2xl backdrop-blur-xl transition-transform duration-300 ease-out dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100",
        open ? "translate-x-0" : "pointer-events-none translate-x-full"
      )}
      aria-hidden={!open}
    >
      {/* header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-violet-400" />
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">AI Assistant</span>
          <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-600 dark:text-cyan-300">
            Groq
          </span>
          <span className="text-[10px] text-zinc-500">AI Generated</span>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-900/5 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
          aria-label="Close assistant"
        >
          <X size={18} />
        </button>
      </div>

      {/* messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed",
                m.role === "user"
                  ? "bg-violet-500 text-white"
                  : "border border-zinc-200/80 bg-white text-zinc-800 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200"
              )}
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
            />
          </div>
        ))}
        {streaming && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Loader2 size={13} className="animate-spin" />
            thinking…
          </div>
        )}
      </div>

      {/* composer */}
      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            rows={1}
            placeholder="Ask for post ideas, bios, outreach drafts…"
            className="max-h-28 min-h-10 flex-1 resize-none rounded-lg border border-slate-300/60 bg-slate-100/90 px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-500 focus:border-violet-500/50 focus:outline-none dark:border-zinc-700/60 dark:bg-zinc-800/50 dark:text-zinc-100"
          />
          <button
            onClick={() => void handleSend()}
            disabled={streaming || !input.trim()}
            className="grid size-10 shrink-0 place-items-center rounded-lg bg-violet-500 text-white transition hover:bg-violet-400 disabled:opacity-40"
            aria-label="Send"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default AiAssistant;
