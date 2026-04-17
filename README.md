# TwinMind: Real-time AI Meeting Assistant

TwinMind is an always-on AI meeting copilot designed to surface the right information at exactly the right time. This project was built for the TwinMind Live Suggestions Assignment and implements continuous Voice Activity Detection (VAD) audio chunking, adaptive AI intelligence, and seamless contextual continuity.

## 🚀 Key Features

*   **Live Smart Suggestions:** An intelligent dashboard automatically generates 3 contextual suggestions (Fact-checks, Questions, Talking Points, etc.) by analyzing the ongoing meeting transcript in real-time.
*   **Intelligent VAD Audio Slicing:** Rather than blindly slicing the microphone feed every 15-30 seconds (which cuts sentences in half), TwinMind tracks live mic volume telemetry to natively detect silence. It slices audio perfectly between conversational pauses ensuring flawless transcription accuracy.
*   **Adaptive Context Window:** The UI separates temporal concerns—the Live Suggestions generator only looks at the exact last ~90 seconds of speech (to maximize speed and relevancy), while the Deep-dive Chat interface is continuously injected with the entire meeting timeline.
*   **Speaker Intent Detection:** The AI live-analyzes the emotional and structural intent of the speaker (*Pitching, Questioning, Debating, Uncertain*) and renders color-coded badges to adapt the interface's psychological footprint in real-time.
*   **Infinite RAG Feed:** New suggestions don't just overwrite old ones; they prepend directly into an infinitely scrolling feed, serving as an organic memory log of AI thoughts generated throughout the session.

---

## 🛠️ Stack Choices

*   **Frontend**: Next.js 15 (App Router) + React 19. Chosen for optimal component-level state control and Server-Side API isolation.
*   **Styling**: Pure CSS (`globals.css`). We utilized bespoke CSS var tokens for a cohesive dark-glassmorphism aesthetic instead of Tailwind to hit the exact premium UX prototype spec without dependency bloat.
*   **Backend / AI Wrapper**: Next.js API Routes.
*   **Transcription**: Groq's `whisper-large-v3-turbo` model via `MediaRecorder` Blob processing. Very fast, highly accurate, open-source.
*   **LLM Processing**: `meta-llama/llama-4-scout-17b-16e-instruct` hosted on Groq. Chosen for its blazingly fast inference which is the hard requirement for "real-time" UX.

---

## 🧠 Prompt Strategy

We heavily prioritized specialized, tightly bound "Role Prompts" to ensure no latency lag from generalized multi-shot prompts.

1.  **The Live Suggestion Prompt:** This system prompt forces exactly one strict JSON array containing type definitions `[question, factcheck, idea, talking_point, answer]` and priority queues `[high, medium, low]`. It strictly instructs the AI to ignore broad generic advice and target the immediate `LAST 90 SECONDS` context matrix.
2.  **The Detail Expansion Prompt:** When a user taps a card, we use a totally different prompt. We inject the *entire* historical transcript and shift the persona to provide a heavy-duty Markdown breakdown (Direct Answer -> Key Points -> Follow-up).
3.  **The Intent Extraction Prompt:** We bundled the speaker intent extraction directly into the original JSON Suggestions output. This saves an entire Groq API request layer, rendering structural emotional analytics at zero extra latency cost.

---

## ⚖️ Tradeoffs & Future Iterations

*   **Cost vs Local Execution:** Currently, audio blobs are sliced and streamed via HTTP to Groq. For `production-readiness at scale`, replacing this with an in-browser WebAssembly port of Whisper (`whisper.wasm`) would drastically reduce network reliance, server load, and API costs—at the tradeoff of higher initial client CPU usage.
*   **Lack of Diarization:** Groq Whisper currently does not actively support multi-speaker diarization out-of-the-box in its REST wrappers. In a longer-form implementation phase, processing the audio arrays through an independent PyTorch backend would enable tagging "Speaker A" and "Speaker B".
*   **Client-Side Memory:** We cap the RAG memory visualization at 50 nodes and 1,500 transcript blocks to preserve React Virtual DOM performance on multi-hour meetings.

---

## 📦 Setup & Deployment

1.  **Install dependencies:**
    ```bash
    npm install
    ```
2.  **Configure API Key:**
    Inside the web interface, click the **Settings** gear to configure your Groq API key and customize default prompt layouts. For server-side fallbacks, create an `.env.local` file containing:
    ```env
    GROQ_API_KEY=gsk_your_key_here
    ```
3.  **Run Locally:**
    ```bash
    npm run dev
    ```

*Ready for deployment to Vercel/Render as a standard Node Web Service.*
