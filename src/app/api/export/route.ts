import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { transcript, suggestions, chatHistory, sessionDuration, format } =
      await req.json();

    const sessionDate = new Date().toISOString();

    if (format === "json") {
      const data = {
        session: {
          exported_at: sessionDate,
          duration_seconds: sessionDuration,
        },
        transcript: transcript.map(
          (
            t: {
              text: string;
              timestamp: string;
              duration?: number;
            },
            i: number
          ) => ({
            index: i + 1,
            timestamp: t.timestamp,
            text: t.text,
            duration_seconds: t.duration,
          })
        ),
        suggestions: suggestions.map(
          (
            s: {
              type: string;
              priority: string;
              text: string;
              reasoning?: string;
              timestamp: string;
            }
          ) => ({
            type: s.type,
            priority: s.priority,
            text: s.text,
            reasoning: s.reasoning,
            generated_at: s.timestamp,
          })
        ),
        chat: chatHistory.map(
          (m: { role: string; content: string; timestamp: string }) => ({
            role: m.role,
            message: m.content,
            timestamp: m.timestamp,
          })
        ),
      };
      return NextResponse.json(data);
    }

    // Plain text format
    let text = `TWINMIND MEETING SESSION\n`;
    text += `Exported: ${sessionDate}\n`;
    text += `Duration: ${Math.floor(sessionDuration / 60)}m ${sessionDuration % 60}s\n`;
    text += `${"=".repeat(60)}\n\n`;

    text += `TRANSCRIPT\n${"─".repeat(40)}\n`;
    for (const t of transcript) {
      text += `[${t.timestamp}] ${t.text}\n`;
    }

    text += `\n\nAI SUGGESTIONS (${suggestions.length} total)\n${"─".repeat(40)}\n`;
    for (const s of suggestions) {
      text += `\n[${s.type.toUpperCase()} • ${s.priority} priority] @ ${s.timestamp}\n`;
      text += `${s.text}\n`;
      if (s.reasoning) text += `→ ${s.reasoning}\n`;
    }

    text += `\n\nCHAT HISTORY\n${"─".repeat(40)}\n`;
    for (const m of chatHistory) {
      text += `\n[${m.role.toUpperCase()}] ${m.content}\n`;
    }

    return new NextResponse(text, {
      headers: {
        "Content-Type": "text/plain",
        "Content-Disposition": `attachment; filename="twinmind-session-${Date.now()}.txt"`,
      },
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error("Export error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
