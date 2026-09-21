import { NextResponse } from "next/server";

export const runtime = "nodejs";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-20b";

/** GET /api/ai/stream — lightweight status probe for the hero's live indicator. */
export async function GET() {
  const configured = Boolean(process.env.GROQ_API_KEY);
  return NextResponse.json(
    { configured, model: MODEL },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * POST /api/ai/stream — proxies a chat completion to Groq and streams
 * the response back as Server-Sent Events tokens. The GROQ_API_KEY stays
 * server-side; the browser only ever talks to this route.
 */
export async function POST(req: Request) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "AI assistant is not configured. Add GROQ_API_KEY to .env.local and restart the server.",
        configured: false,
      },
      { status: 503 }
    );
  }

  let prompt = "";
  let context = "";
  try {
    const body = (await req.json()) as { prompt?: string; context?: string };
    prompt = (body.prompt ?? "").slice(0, 4000);
    context = (body.context ?? "").slice(0, 2000);
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!prompt.trim()) {
    return NextResponse.json({ error: "Give the assistant a prompt." }, { status: 400 });
  }

  try {
    const upstream = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are Motion's built-in assistant for a student networking platform. Be concise, friendly, and practical. Help with post ideas, bios, collaboration outreach, and event copy.",
          },
          ...(context ? [{ role: "system" as const, content: `Context: ${context}` }] : []),
          { role: "user", content: prompt },
        ],
        stream: true,
        temperature: 0.7,
        max_tokens: 600,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: `Groq request failed (${upstream.status}).`, detail: detail.slice(0, 300) },
        { status: 502 }
      );
    }

    // Convert Groq's OpenAI-style chunks into SSE `data:` lines.
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let buffer = "";

    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body!.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const payload = trimmed.slice(5).trim();
              if (payload === "[DONE]") {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                continue;
              }
              try {
                const json = JSON.parse(payload) as {
                  choices?: Array<{ delta?: { content?: string } }>;
                };
                const token = json.choices?.[0]?.delta?.content;
                if (token) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
                }
              } catch {
                /* skip malformed chunk */
              }
            }
          }
        } finally {
          controller.close();
          reader.releaseLock();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach the AI service. Try again shortly." },
      { status: 502 }
    );
  }
}
