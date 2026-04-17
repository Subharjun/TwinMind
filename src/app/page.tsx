"use client";

import { useState, useRef, useEffect, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TranscriptBlock {
  id: string;
  text: string;
  timestamp: string;
  duration?: number;
}

type SuggestionType = "question" | "factcheck" | "idea" | "talking_point" | "answer";
type PriorityLevel = "high" | "medium" | "low";
type SpeakerIntent = "pitching" | "questioning" | "explaining" | "debating" | "uncertain" | "discussing";

interface Suggestion {
  id: string;
  type: SuggestionType;
  priority: PriorityLevel;
  text: string;
  reasoning: string;
  timestamp: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

// ─── Tag config ──────────────────────────────────────────────────────────────

const TAG_CONFIG: Record<SuggestionType, { emoji: string; label: string; className: string }> = {
  question:     { emoji: "❓", label: "Question",      className: "tag-question" },
  factcheck:    { emoji: "⚠️", label: "Fact-Check",    className: "tag-factcheck" },
  idea:         { emoji: "💡", label: "Idea",           className: "tag-idea" },
  talking_point:{ emoji: "🎯", label: "Talking Point", className: "tag-talking" },
  answer:       { emoji: "✅", label: "Smart Answer",  className: "tag-answer" },
};

const PRIORITY_CLASS: Record<PriorityLevel, string> = {
  high: "priority-high",
  medium: "priority-medium",
  low: "priority-low",
};

const INTENT_LABELS: Record<SpeakerIntent, { emoji: string; label: string; color: string }> = {
  pitching:    { emoji: "🚀", label: "Pitching",    color: "#f59e0b" },
  questioning: { emoji: "🤔", label: "Questioning", color: "#06b6d4" },
  explaining:  { emoji: "📖", label: "Explaining",  color: "#818cf8" },
  debating:    { emoji: "⚡", label: "Debating",    color: "#f43f5e" },
  uncertain:   { emoji: "🌀", label: "Uncertain",   color: "#8b5cf6" },
  discussing:  { emoji: "💬", label: "Discussing",  color: "#10b981" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function nowTimestamp() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function uid() {
  return Math.random().toString(36).slice(2);
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function TwinMindApp() {
  // Mic & recording
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [audioLevel, setAudioLevel] = useState<number[]>([3,3,3,3,3,3,3]);

  // Transcript
  const [transcript, setTranscript] = useState<TranscriptBlock[]>([]);
  const transcriptRef = useRef<TranscriptBlock[]>([]);
  const [liveText, setLiveText] = useState("");
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Suggestions
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [allSuggestions, setAllSuggestions] = useState<Suggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [speakerIntent, setSpeakerIntent] = useState<SpeakerIntent>("discussing");
  const [nextRefresh, setNextRefresh] = useState(30);
  const [refreshProgress, setRefreshProgress] = useState(0);

  // Chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  // Detail sheet
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailContent, setDetailContent] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSuggestion, setDetailSuggestion] = useState<Suggestion | null>(null);

  // Toast
  const [toast, setToast] = useState("");
  const [toastVisible, setToastVisible] = useState(false);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeTypeRef = useRef<string>("audio/webm;codecs=opus");
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const chunkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const suggestionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const refreshCountdownRef = useRef<NodeJS.Timeout | null>(null);

  // VAD logic
  const isSilentRef = useRef(true);
  const silenceStartRef = useRef<number | null>(null);
  const chunkStartRef = useRef<number>(Date.now());

  // ── Auto-scroll ──────────────────────────────────────────────────────────

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, liveText]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isChatLoading]);

  // ── Toast helper ──────────────────────────────────────────────────────────

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2500);
  }, []);

  // ── Get transcript text helpers ───────────────────────────────────────────

  const getFullTranscript = useCallback(() => {
    return transcriptRef.current.map(b => `[${b.timestamp}] ${b.text}`).join("\n");
  }, []); // using ref directly avoids stale closures

  // Last ~90 seconds approx: last 3 blocks (each ~30s)
  const getRecentContext = useCallback(() => {
    const recent = transcriptRef.current.slice(-3);
    return recent.map(b => b.text).join(" ") + (liveText ? " " + liveText : "");
  }, [liveText]); // liveText still needed to trigger standard updates if it's changing

  // ── Suggestions engine ────────────────────────────────────────────────────

  const fetchSuggestions = useCallback(async () => {
    const recent = getRecentContext();
    if (recent.trim().length < 15) return;

    setIsLoadingSuggestions(true);
    try {
      const res = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recentContext: recent,
          fullTranscript: getFullTranscript(),
        }),
      });
      const data = await res.json();

      if (data.suggestions && Array.isArray(data.suggestions)) {
        const stamped: Suggestion[] = data.suggestions.map((s: Omit<Suggestion, "id" | "timestamp">) => ({
          ...s,
          id: uid(),
          timestamp: nowTimestamp(),
        }));
        // Prepend new suggestions to the top so it builds an infinite feed
        setSuggestions(prev => {
          // Keep maximum 50 suggestions so the browser doesn't lag on massive meetings
          const combined = [...stamped, ...prev];
          return combined.slice(0, 50);
        });
        setAllSuggestions(prev => [...prev, ...stamped]);
        if (data.speaker_intent) setSpeakerIntent(data.speaker_intent as SpeakerIntent);
      }
    } catch (e) {
      console.error("Suggestions fetch failed:", e);
    } finally {
      setIsLoadingSuggestions(false);
    }
  }, [getRecentContext, getFullTranscript]);

  // ── Audio visualizer ──────────────────────────────────────────────────────

  const startVisualizer = useCallback((stream: MediaStream) => {
    audioContextRef.current = new AudioContext();
    analyserRef.current = audioContextRef.current.createAnalyser();
    analyserRef.current.fftSize = 32;
    const src = audioContextRef.current.createMediaStreamSource(stream);
    src.connect(analyserRef.current);

    const draw = () => {
      if (!analyserRef.current) return;
      const data = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(data);
      const bars = Array.from({ length: 7 }, (_, i) => {
        const val = data[i * 2] || 0;
        return Math.max(3, Math.round((val / 255) * 22));
      });
      setAudioLevel(bars);

      // determine silence for VAD chunking
      const avg = bars.reduce((a, b) => a + b, 0) / bars.length;
      // 3 is baseline min, so > 4 means there's some audio
      isSilentRef.current = avg <= 4; 

      animFrameRef.current = requestAnimationFrame(draw);
    };
    draw();
  }, []);

  const stopVisualizer = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    audioContextRef.current?.close();
    audioContextRef.current = null;
    analyserRef.current = null;
    setAudioLevel([3,3,3,3,3,3,3]);
  }, []);

  // ── Send audio chunk to Whisper ───────────────────────────────────────────

  const sendChunk = useCallback(async (blob: Blob) => {
    if (blob.size < 1500) return; // skip tiny/silent chunks
    const form = new FormData();
    // Pick extension based on mime type so Whisper recognises the container
    const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "mp4" : "webm";
    form.append("audio", blob, `chunk.${ext}`);

    setLiveText("🎙 Transcribing...");
    try {
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await res.json();
      if (data.text && data.text.trim()) {
        const block: TranscriptBlock = {
          id: uid(),
          text: data.text.trim(),
          timestamp: nowTimestamp(),
          duration: data.duration,
        };
        setTranscript(prev => {
          const next = [...prev, block];
          transcriptRef.current = next; // sync ref
          return next;
        });
        setLiveText("");
      } else {
        setLiveText("");
      }
    } catch {
      setLiveText("");
    }
  }, []);

  // ── Create a fresh MediaRecorder on the existing stream ───────────────────
  // Each recorder produces a self-contained file with its own header,
  // which is required for Groq Whisper to accept the blob.

  const startFreshRecorder = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;

    const mr = new MediaRecorder(stream, { mimeType: mimeTypeRef.current });
    mediaRecorderRef.current = mr;
    chunksRef.current = [];

    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    mr.onstop = () => {
      // After stop, build a complete blob and send it
      if (chunksRef.current.length > 0) {
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        chunksRef.current = [];
        sendChunk(blob);
      }
    };

    mr.start();
  }, [sendChunk]);

  // ── Start recording ───────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      startVisualizer(stream);

      // Pick the best supported MIME type
      mimeTypeRef.current = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/ogg;codecs=opus";

      // Start first recorder segment
      chunkStartRef.current = Date.now();
      silenceStartRef.current = null;
      startFreshRecorder();
      setIsRecording(true);
      setElapsed(0);

      // Timer
      timerRef.current = setInterval(() => setElapsed(p => p + 1), 1000);

      // Smart VAD chunking loop
      chunkIntervalRef.current = setInterval(() => {
        const mr = mediaRecorderRef.current;
        if (!mr || mr.state !== "recording") return;

        const now = Date.now();
        const chunkDuration = now - chunkStartRef.current;

        // Force cut if the chunk gets too long (20s) so we aren't waiting forever
        if (chunkDuration > 20000) {
          mr.stop();
          setTimeout(startFreshRecorder, 200);
          chunkStartRef.current = now;
          silenceStartRef.current = null;
          return;
        }

        // If we have at least 3 seconds of audio, look for a pause
        if (chunkDuration > 3000) {
          if (isSilentRef.current) {
            if (silenceStartRef.current === null) {
              silenceStartRef.current = now;
            } else if (now - silenceStartRef.current > 1500) {
              // 1.5 seconds of sustained silence detected! Cut perfectly between sentences.
              mr.stop();
              setTimeout(startFreshRecorder, 200);
              chunkStartRef.current = now;
              silenceStartRef.current = null;
            }
          } else {
            silenceStartRef.current = null; // reset if they speak again
          }
        }
      }, 200); // check 5 times a second

      // Suggestions every 30 seconds
      setNextRefresh(30);
      setRefreshProgress(0);

      let countdown = 30;
      refreshCountdownRef.current = setInterval(() => {
        countdown -= 1;
        setNextRefresh(countdown);
        setRefreshProgress(((30 - countdown) / 30) * 100);
        if (countdown <= 0) countdown = 30;
      }, 1000);

      suggestionIntervalRef.current = setInterval(() => {
        fetchSuggestions();
        countdown = 30;
        setNextRefresh(30);
        setRefreshProgress(0);
      }, 30000);

      // Initial suggestion after 10 seconds
      setTimeout(fetchSuggestions, 10000);

    } catch (err) {
      console.error("Mic error:", err);
      showToast("❌ Microphone access denied");
    }
  }, [startVisualizer, startFreshRecorder, fetchSuggestions, showToast]);

  // ── Stop recording ────────────────────────────────────────────────────────

  const stopRecording = useCallback(async () => {
    // Stop the chunk rotation interval first
    clearInterval(chunkIntervalRef.current!);
    clearInterval(suggestionIntervalRef.current!);
    clearInterval(refreshCountdownRef.current!);
    clearInterval(timerRef.current!);

    // Stop current recorder — onstop will flush the last blob automatically
    const mr = mediaRecorderRef.current;
    if (mr && mr.state === "recording") {
      mr.stop();
      await new Promise(r => setTimeout(r, 600)); // wait for onstop to fire
    }

    // Stop all mic tracks
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;

    stopVisualizer();
    setIsRecording(false);
    setLiveText("");
    
    // Instead of just ending instantly, let's grab the final suggestions
    // based on the very last thing the user said.
    showToast("✅ Session ended — generating final suggestions...");
    
    // Wait roughly 2.5s for the final audio chunk to finish transcribing, 
    // then trigger one last suggestion generation batch.
    setTimeout(() => {
      fetchSuggestions();
    }, 2500);

  }, [stopVisualizer, fetchSuggestions, showToast]);

  // ── Suggestion card click ─────────────────────────────────────────────────

  const onSuggestionClick = useCallback(async (s: Suggestion) => {
    setDetailSuggestion(s);
    setDetailOpen(true);
    setDetailContent("");
    setDetailLoading(true);

    // Also push to chat
    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: `[${TAG_CONFIG[s.type].label}] ${s.text}`,
      timestamp: nowTimestamp(),
    };
    setChatMessages(prev => [...prev, userMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: s.text,
          fullTranscript: getFullTranscript(),
          chatHistory: chatMessages,
          mode: "detail",
        }),
      });
      const data = await res.json();
      const reply = data.response || "No response";
      setDetailContent(reply);

      const aiMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: reply,
        timestamp: nowTimestamp(),
      };
      setChatMessages(prev => [...prev, aiMsg]);
    } catch {
      setDetailContent("Failed to get detailed response. Please try again.");
    } finally {
      setDetailLoading(false);
    }
  }, [chatMessages, getFullTranscript]);

  // ── Chat send ─────────────────────────────────────────────────────────────

  const sendChat = useCallback(async (text: string) => {
    const msg = text.trim();
    if (!msg || isChatLoading) return;

    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: msg,
      timestamp: nowTimestamp(),
    };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    setIsChatLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          fullTranscript: getFullTranscript(),
          chatHistory: [...chatMessages, userMsg],
          mode: "chat",
        }),
      });
      const data = await res.json();
      const aiMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: data.response || "No response",
        timestamp: nowTimestamp(),
      };
      setChatMessages(prev => [...prev, aiMsg]);
    } catch {
      const errMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: "Sorry, I couldn't process that. Check your connection.",
        timestamp: nowTimestamp(),
      };
      setChatMessages(prev => [...prev, errMsg]);
    } finally {
      setIsChatLoading(false);
    }
  }, [chatMessages, getFullTranscript, isChatLoading]);

  // ── Export ────────────────────────────────────────────────────────────────

  const exportSession = useCallback(async (format: "json" | "text") => {
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          suggestions: allSuggestions,
          chatHistory: chatMessages,
          sessionDuration: elapsed,
          format,
        }),
      });

      if (format === "json") {
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `twinmind-session-${Date.now()}.json`;
        a.click();
      } else {
        const text = await res.text();
        const blob = new Blob([text], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `twinmind-session-${Date.now()}.txt`;
        a.click();
      }

      showToast(`📥 Exported as ${format.toUpperCase()}`);
    } catch {
      showToast("❌ Export failed");
    }
  }, [transcript, allSuggestions, chatMessages, elapsed, showToast]);

  // ── Manual suggestion refresh ─────────────────────────────────────────────

  const manualRefresh = useCallback(() => {
    fetchSuggestions();
    setNextRefresh(30);
    setRefreshProgress(0);
    showToast("🔄 Refreshing suggestions...");
  }, [fetchSuggestions, showToast]);

  // ── Render markdown-lite (bold) ───────────────────────────────────────────

  function renderMarkdown(text: string) {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, i) =>
      p.startsWith("**") && p.endsWith("**")
        ? <strong key={i} style={{ color: "#f0f4ff" }}>{p.slice(2, -2)}</strong>
        : p
    );
  }

  // ── Intent badge ──────────────────────────────────────────────────────────

  const intent = INTENT_LABELS[speakerIntent] || INTENT_LABELS.discussing;

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="app-container">
      {/* HEADER */}
      <header className="header">
        <div className="logo">
          <div className="logo-icon">🧠</div>
          <span className="logo-text">TwinMind</span>
        </div>

        <div className="header-center">
          <span className="session-badge">
            {isRecording
              ? `🔴 Recording • ${formatTime(elapsed)}`
              : elapsed > 0
              ? `Session: ${formatTime(elapsed)}`
              : "Ready to record"}
          </span>
          {isRecording && (
            <span
              className="session-badge"
              style={{ color: intent.color, borderColor: `${intent.color}30` }}
            >
              {intent.emoji} {intent.label}
            </span>
          )}
        </div>

        <div className="header-actions">
          {(transcript.length > 0 || chatMessages.length > 0) && (
            <>
              <button className="btn btn-ghost" id="export-json-btn" onClick={() => exportSession("json")}>
                JSON
              </button>
              <button className="btn btn-ghost" id="export-txt-btn" onClick={() => exportSession("text")}>
                TXT
              </button>
            </>
          )}
          {!isRecording ? (
            <button className="btn btn-primary" id="start-recording-btn" onClick={startRecording}>
              🎤 Start Session
            </button>
          ) : (
            <button className="btn btn-danger" id="stop-recording-btn" onClick={stopRecording}>
              ⏹ End Session
            </button>
          )}
        </div>
      </header>

      {/* MAIN GRID */}
      <div className="main-grid">

        {/* ── LEFT: Transcript ── */}
        <div className="panel" style={{ background: "var(--bg-secondary)" }}>
          {/* Mic orb section */}
          <div className="mic-section">
            <div className="mic-orb-wrapper">
              {isRecording && (
                <>
                  <div className="mic-ring" />
                  <div className="mic-ring" />
                  <div className="mic-ring" />
                </>
              )}
              <div
                className={`mic-orb ${isRecording ? "recording" : ""}`}
                onClick={isRecording ? stopRecording : startRecording}
                role="button"
                id="mic-orb"
                aria-label={isRecording ? "Stop recording" : "Start recording"}
              >
                {isRecording ? "🎙" : "🎤"}
              </div>
            </div>

            {/* Audio bars */}
            <div className="audio-bars">
              {audioLevel.map((h, i) => (
                <div
                  key={i}
                  className={`audio-bar ${isRecording ? "active-bar" : ""}`}
                  style={{ height: `${h}px` }}
                />
              ))}
            </div>

            <div className="mic-status">
              <span className={`status-dot ${isRecording ? "active" : ""}`} />
              <span className="text-muted text-xs">
                {isRecording ? "Listening..." : "Click to start"}
              </span>
            </div>

            <div className={`timer ${isRecording ? "recording" : ""}`}>
              {formatTime(elapsed)}
            </div>
          </div>

          {/* Transcript header */}
          <div className="panel-header">
            <span className="panel-title">
              📝 Transcript
              {transcript.length > 0 && (
                <span style={{ color: "var(--accent-purple-light)", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>
                  {transcript.length} blocks
                </span>
              )}
            </span>
          </div>

          {/* Transcript body */}
          <div className="panel-body">
            {transcript.length === 0 && !liveText ? (
              <div className="empty-state">
                <div className="empty-state-icon">🎙</div>
                <div className="empty-state-text">
                  Start recording to see your live transcript here
                </div>
              </div>
            ) : (
              <>
                {transcript.map((block) => (
                  <div key={block.id} className="transcript-block fade-in">
                    <div className="transcript-time">{block.timestamp}</div>
                    <div className="transcript-text">{block.text}</div>
                  </div>
                ))}
                {liveText && (
                  <div className="transcript-block transcript-live fade-in">
                    <div className="transcript-time">live</div>
                    <div className="transcript-text">
                      {liveText}
                      <span className="typing-cursor" />
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={transcriptEndRef} />
          </div>
        </div>

        {/* ── MIDDLE: Suggestions ── */}
        <div className="panel suggestions-panel">
          <div className="panel-header">
            <span className="panel-title">
              🧠 Live Suggestions
            </span>
            <div className="flex gap-2">
              <button
                className="btn-icon"
                id="refresh-suggestions-btn"
                onClick={manualRefresh}
                title="Refresh suggestions now"
                disabled={isLoadingSuggestions}
              >
                {isLoadingSuggestions ? "⏳" : "🔄"}
              </button>
            </div>
          </div>

          <div className="panel-body">
            {!isRecording && transcript.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">🧠</div>
                <div className="empty-state-text">
                  AI suggestions appear here during your meeting.<br />
                  Start recording to get context-aware intelligence.
                </div>
              </div>
            ) : isLoadingSuggestions && suggestions.length === 0 ? (
              <>
                {[0,1,2].map(i => (
                  <div key={i} className="skeleton-card fade-in">
                    <div className="skeleton" style={{ height: 12, width: "40%", marginBottom: 10 }} />
                    <div className="skeleton" style={{ height: 14, width: "100%", marginBottom: 6 }} />
                    <div className="skeleton" style={{ height: 14, width: "80%" }} />
                  </div>
                ))}
              </>
            ) : suggestions.length > 0 ? (
              <>
                {isLoadingSuggestions && (
                  <div style={{ textAlign: "center", padding: "8px 0", color: "var(--text-muted)", fontSize: 12 }}>
                    ✨ Refreshing suggestions...
                  </div>
                )}
                {suggestions.map((s, idx) => {
                  const tag = TAG_CONFIG[s.type] || TAG_CONFIG.idea;
                  return (
                    <div
                      key={s.id}
                      className="suggestion-card fade-in"
                      onClick={() => onSuggestionClick(s)}
                      id={`suggestion-${idx}`}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === "Enter" && onSuggestionClick(s)}
                    >
                      <div className="suggestion-card-top">
                        <span className={`suggestion-tag ${tag.className}`}>
                          {tag.emoji} {tag.label}
                        </span>
                        <div className={`suggestion-priority ${PRIORITY_CLASS[s.priority]}`} title={`${s.priority} priority`} />
                      </div>
                      <div className="suggestion-text">{s.text}</div>
                      {s.reasoning && (
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, fontStyle: "italic" }}>
                          {s.reasoning}
                        </div>
                      )}
                      <div className="suggestion-action">
                        Click for detailed answer →
                      </div>
                    </div>
                  );
                })}
              </>
            ) : (
              <div className="empty-state">
                <div style={{ fontSize: 24, opacity: 0.5 }}>⏳</div>
                <div className="empty-state-text">
                  Listening to conversation...<br />
                  Suggestions will appear in {nextRefresh}s
                </div>
              </div>
            )}
          </div>

          {/* Refresh countdown bar */}
          {isRecording && (
            <div className="refresh-bar-wrapper">
              <div className="refresh-label">
                <span>Next refresh in {nextRefresh}s</span>
                <span>{allSuggestions.length} total suggestions</span>
              </div>
              <div className="refresh-bar">
                <div className="refresh-bar-fill" style={{ width: `${refreshProgress}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT: Chat ── */}
        <div className="panel chat-panel">
          <div className="panel-header">
            <span className="panel-title">💬 AI Chat</span>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
              Full context
            </span>
          </div>

          {/* Context strip */}
          {transcript.length > 0 && (
            <div className="context-strip">
              🔗 {transcript.length} transcript blocks loaded as context
            </div>
          )}

          {/* Messages */}
          <div className="chat-messages">
            {chatMessages.length === 0 ? (
              <div className="empty-state" style={{ flex: 1 }}>
                <div className="empty-state-icon">💬</div>
                <div className="empty-state-text">
                  Click a suggestion to get details,<br />
                  or ask me anything about the meeting
                </div>
              </div>
            ) : (
              chatMessages.map((msg) => (
                <div key={msg.id} className={`chat-msg ${msg.role}`}>
                  <div className="chat-msg-bubble">
                    {renderMarkdown(msg.content)}
                  </div>
                  <div className="chat-msg-meta">{msg.timestamp}</div>
                </div>
              ))
            )}
            {isChatLoading && (
              <div className="chat-msg assistant fade-in">
                <div className="typing-indicator">
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="chat-input-area">
            <div className="chat-input-row">
              <textarea
                ref={chatInputRef}
                className="chat-input"
                id="chat-input"
                placeholder="Ask about the meeting..."
                value={chatInput}
                onChange={(e) => {
                  setChatInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendChat(chatInput);
                  }
                }}
                rows={1}
              />
              <button
                className="chat-send-btn"
                id="chat-send-btn"
                onClick={() => sendChat(chatInput)}
                disabled={isChatLoading || !chatInput.trim()}
              >
                ➤
              </button>
            </div>
            <div className="chat-hint">Enter to send • Shift+Enter for new line</div>
          </div>
        </div>
      </div>

      {/* ── Detail Sheet ── */}
      <div className={`detail-panel ${detailOpen ? "open" : ""}`}>
        <div
          className="detail-overlay"
          onClick={() => setDetailOpen(false)}
        />
        <div className="detail-sheet">
          <div className="detail-handle" />
          {detailSuggestion && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <span className={`suggestion-tag ${TAG_CONFIG[detailSuggestion.type]?.className}`}>
                  {TAG_CONFIG[detailSuggestion.type]?.emoji} {TAG_CONFIG[detailSuggestion.type]?.label}
                </span>
                <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)" }}>
                  {detailSuggestion.text}
                </span>
              </div>
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
                {detailLoading ? (
                  <>
                    {[1, 0.8, 0.6].map((w, i) => (
                      <div key={i} className="skeleton" style={{ height: 14, width: `${w * 100}%`, marginBottom: 10 }} />
                    ))}
                  </>
                ) : (
                  <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-primary)" }}>
                    {renderMarkdown(detailContent)}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Toast ── */}
      <div className={`toast ${toastVisible ? "show" : ""}`}>{toast}</div>
    </div>
  );
}
