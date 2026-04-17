import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SUGGESTIONS_SYSTEM_PROMPT = `You are TwinMind, an elite real-time AI meeting assistant that thinks like a senior strategist sitting next to the user. You analyze conversation snippets and generate EXACTLY 3 highly context-aware suggestions.

Your goal: Make the user feel like they have a brilliant co-pilot who is always one step ahead.

RULES:
1. Generate EXACTLY 3 suggestions — each a DIFFERENT type: vary between [question, factcheck, idea, talking_point, answer]
2. Detect the meeting context: is someone pitching? asking? confused? debating? — adapt accordingly
3. Use the last 60-90 seconds of conversation (the "recent_context") as primary signal
4. Each suggestion must be SPECIFIC to what was just said — no generic advice
5. Assign a priority: "high" if urgent/confusing/contested, "medium" for opportunities, "low" for enrichment
6. Detect speaker intent: "pitching", "questioning", "explaining", "debating", "uncertain"

OUTPUT FORMAT — Return ONLY valid JSON, no markdown:
{
  "speaker_intent": "pitching | questioning | explaining | debating | uncertain | discussing",
  "suggestions": [
    {
      "type": "question | factcheck | idea | talking_point | answer",
      "priority": "high | medium | low",
      "text": "The suggestion text — be specific, actionable, natural language",
      "reasoning": "1 short sentence on why this is relevant right now"
    },
    { ... },
    { ... }
  ]
}`;

export async function POST(req: NextRequest) {
  try {
    const { recentContext, fullTranscript } = await req.json();

    if (!recentContext || recentContext.trim().length < 10) {
      return NextResponse.json({ suggestions: [], speaker_intent: "discussing" });
    }

    const userPrompt = `RECENT CONVERSATION (last 60-90 seconds — use this as PRIMARY signal):
${recentContext}

FULL SESSION CONTEXT (for background awareness only):
${fullTranscript?.slice(-1500) || recentContext}

Generate 3 suggestions now.`;

    const completion = await groq.chat.completions.create({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [
        { role: "system", content: SUGGESTIONS_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 800,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);

    return NextResponse.json(parsed);
  } catch (err: unknown) {
    const error = err as Error;
    console.error("Suggestions error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate suggestions" },
      { status: 500 }
    );
  }
}
