import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const DETAIL_SYSTEM_PROMPT = `You are TwinMind, an elite meeting assistant. A suggestion card was clicked — now give a thorough, structured, and immediately useful response.

Structure your response as:
1. **Direct Answer** — Lead with the core insight (2-3 sentences)
2. **Key Points** — 3-4 bullet points with specifics
3. **Follow-up** — 1 question or action the user should consider next

Keep it concise but meaty. Be specific to the context. Use **bold** for key terms.`;

const CHAT_SYSTEM_PROMPT = `You are TwinMind, an elite real-time AI meeting assistant with full context of the ongoing conversation.

You help users:
- Answer questions about what was discussed
- Provide facts, clarifications, and analysis
- Suggest what to say or ask next
- Identify risks, opportunities, or missing information

Be conversational, direct, and specific. Use the meeting transcript as your primary context. If something wasn't discussed, say so. Use **bold** for important terms. Keep responses focused and actionable.`;

export async function POST(req: NextRequest) {
  try {
    const { message, fullTranscript, chatHistory, mode } = await req.json();

    const isDetail = mode === "detail";
    const systemPrompt = isDetail ? DETAIL_SYSTEM_PROMPT : CHAT_SYSTEM_PROMPT;

    const messages: Groq.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
    ];

    if (fullTranscript) {
      messages.push({
        role: "user",
        content: `FULL MEETING TRANSCRIPT:\n${fullTranscript}`,
      });
      messages.push({
        role: "assistant",
        content: "I have the full meeting context. How can I help?",
      });
    }

    // Add chat history
    if (chatHistory && Array.isArray(chatHistory)) {
      for (const msg of chatHistory.slice(-10)) {
        messages.push({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        });
      }
    }

    messages.push({ role: "user", content: message });

    const completion = await groq.chat.completions.create({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages,
      temperature: 0.65,
      max_tokens: 1000,
    });

    const response =
      completion.choices[0]?.message?.content || "No response generated.";

    return NextResponse.json({ response });
  } catch (err: unknown) {
    const error = err as Error;
    console.error("Chat error:", error);
    return NextResponse.json(
      { error: error.message || "Chat failed" },
      { status: 500 }
    );
  }
}
