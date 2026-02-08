"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface ChatMessage {
  id: string;
  source: "TEXTE" | "VOCAL" | "WEB" | "APPEL";
  userMessage: string;
  jarvisResponse: string;
  timestamp: number;
}

type AuthStep = "password" | "otp" | "authenticated";
type CallState = "idle" | "listening" | "thinking" | "speaking";

// Extend Window for SpeechRecognition
interface SpeechRecognitionEvent {
  results: { [key: number]: { [key: number]: { transcript: string } }; length: number };
  resultIndex: number;
}
interface SpeechRecognitionErrorEvent {
  error: string;
}
interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onspeechend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

export default function Home() {
  // Auth state
  const [authStep, setAuthStep] = useState<AuthStep>("password");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Call mode state
  const [callActive, setCallActive] = useState(false);
  const [callState, setCallState] = useState<CallState>("idle");
  const [callTranscript, setCallTranscript] = useState("");
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const callActiveRef = useRef(false);
  const callLoopRunning = useRef(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Check existing session on load
  useEffect(() => {
    const token = localStorage.getItem("mark01_token");
    if (token) {
      verifyToken(token);
    } else {
      setLoadingHistory(false);
    }
  }, []);

  // Auto-scroll on new message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Verify existing token
  async function verifyToken(token: string) {
    try {
      const res = await fetch("/api/chat", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAuthToken(token);
        setAuthStep("authenticated");
        setMessages(data.messages || []);
      } else {
        localStorage.removeItem("mark01_token");
      }
    } catch {
      localStorage.removeItem("mark01_token");
    }
    setLoadingHistory(false);
  }

  // Step 1: Password login
  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();

      if (res.ok) {
        setOtpToken(data.otpToken);
        setAuthStep("otp");
      } else {
        setAuthError(data.error || "Mot de passe incorrect");
      }
    } catch {
      setAuthError("Erreur de connexion");
    }
    setAuthLoading(false);
  }

  // Step 2: OTP verification
  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);

    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp, password, otpToken }),
      });
      const data = await res.json();

      if (res.ok) {
        localStorage.setItem("mark01_token", data.token);
        setAuthToken(data.token);
        setAuthStep("authenticated");
        loadChatHistory(data.token);
      } else {
        setAuthError(data.error || "Code invalide");
      }
    } catch {
      setAuthError("Erreur de connexion");
    }
    setAuthLoading(false);
  }

  // Load chat history
  const loadChatHistory = useCallback(async (token: string) => {
    try {
      const res = await fetch("/api/chat", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch {
      // Silently fail
    }
    setLoadingHistory(false);
  }, []);

  // Send message
  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending || !authToken) return;

    const userMsg = input.trim();
    setInput("");
    setSending(true);

    // Ajouter le message utilisateur immediatement
    const tempId = `temp-${Date.now()}`;
    const newMsg: ChatMessage = {
      id: tempId,
      source: "WEB",
      userMessage: userMsg,
      jarvisResponse: "",
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, newMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ message: userMsg }),
      });

      const data = await res.json();

      if (res.ok) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? { ...m, id: data.id || tempId, jarvisResponse: data.response }
              : m
          )
        );
      } else if (res.status === 401) {
        localStorage.removeItem("mark01_token");
        setAuthToken(null);
        setAuthStep("password");
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? { ...m, jarvisResponse: `Erreur: ${data.error || "Inconnue"}` }
              : m
          )
        );
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId
            ? { ...m, jarvisResponse: "Erreur de connexion au serveur." }
            : m
        )
      );
    }

    setSending(false);
    inputRef.current?.focus();
  }

  // ===================== CALL MODE =====================

  // Init speech synthesis
  useEffect(() => {
    if (typeof window !== "undefined") {
      synthRef.current = window.speechSynthesis;
    }
  }, []);

  // TTS: prononcer un texte et attendre la fin
  function speakText(text: string): Promise<void> {
    return new Promise((resolve) => {
      const synth = synthRef.current;
      if (!synth) { resolve(); return; }

      synth.cancel(); // Couper tout TTS en cours

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "fr-FR";
      utterance.rate = 1.05;
      utterance.pitch = 0.9;

      // Selectionner une voix francaise
      const voices = synth.getVoices();
      const frVoice = voices.find(v => v.lang.startsWith("fr") && v.localService) ||
                      voices.find(v => v.lang.startsWith("fr"));
      if (frVoice) utterance.voice = frVoice;

      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      synth.speak(utterance);
    });
  }

  // STT: ecouter une commande vocale (retourne le texte reconnu)
  function listenForSpeech(): Promise<string | null> {
    return new Promise((resolve) => {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) { resolve(null); return; }

      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "fr-FR";
      recognitionRef.current = recognition;

      let resolved = false;
      const done = (val: string | null) => {
        if (!resolved) { resolved = true; resolve(val); }
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const last = event.results.length - 1;
        const transcript = event.results[last][0].transcript;
        setCallTranscript(transcript);
        done(transcript);
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === "no-speech" || event.error === "aborted") {
          done(null);
        } else {
          done(null);
        }
      };

      recognition.onend = () => {
        done(null);
      };

      try {
        recognition.start();
      } catch {
        done(null);
      }
    });
  }

  // Boucle principale du mode appel
  async function callModeLoop(token: string) {
    if (callLoopRunning.current) return;
    callLoopRunning.current = true;

    try {
      while (callActiveRef.current) {
        // Ecouter
        setCallState("listening");
        setCallTranscript("");
        const command = await listenForSpeech();

        if (!callActiveRef.current) break;

        if (!command || !command.trim()) {
          // Silence, re-ecouter
          continue;
        }

        // Detecter les commandes de fin
        const lower = command.trim().toLowerCase();
        if (["raccroche", "raccroche.", "fin d'appel", "stop appel",
             "au revoir", "termine", "arrête", "arrête l'appel",
             "arrete", "arrete l'appel"].includes(lower)) {
          setCallState("speaking");
          await speakText("D'accord, a plus tard.");
          endCallMode();
          return;
        }

        // Afficher le message
        const msgId = `appel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const newMsg: ChatMessage = {
          id: msgId,
          source: "APPEL",
          userMessage: command.trim(),
          jarvisResponse: "",
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, newMsg]);

        // Envoyer a Jarvis
        setCallState("thinking");

        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ message: command.trim(), source: "APPEL" }),
          });

          if (!callActiveRef.current) break;

          const data = await res.json();
          const response = res.ok ? (data.response || "Pas de reponse.") : "Erreur.";

          // Mettre a jour le message
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId ? { ...m, jarvisResponse: response } : m
            )
          );

          // Prononcer la reponse
          if (callActiveRef.current) {
            setCallState("speaking");
            await speakText(response);
          }
        } catch {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId ? { ...m, jarvisResponse: "Erreur de connexion." } : m
            )
          );
        }
      }
    } finally {
      callLoopRunning.current = false;
    }
  }

  // Demarrer le mode appel
  function startCallMode() {
    if (!authToken) return;
    callActiveRef.current = true;
    setCallActive(true);
    setCallState("listening");

    // Confirmation vocale puis lancer la boucle
    speakText("Mode appel active. Je t'ecoute.").then(() => {
      callModeLoop(authToken);
    });
  }

  // Arreter le mode appel
  function endCallMode() {
    callActiveRef.current = false;
    setCallActive(false);
    setCallState("idle");
    setCallTranscript("");

    // Couper le STT et TTS en cours
    recognitionRef.current?.abort();
    synthRef.current?.cancel();
  }

  // Toggle mode appel
  function toggleCallMode() {
    if (callActive) {
      endCallMode();
    } else {
      startCallMode();
    }
  }

  // Logout
  function handleLogout() {
    endCallMode();
    localStorage.removeItem("mark01_token");
    setAuthToken(null);
    setAuthStep("password");
    setMessages([]);
    setPassword("");
    setOtp("");
  }

  // Format timestamp
  function formatTime(ts: number) {
    const d = new Date(ts);
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  function formatDate(ts: number) {
    const d = new Date(ts);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "Hier";
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  }

  // Group messages by date
  function groupByDate(msgs: ChatMessage[]) {
    const groups: { date: string; messages: ChatMessage[] }[] = [];
    let currentDate = "";
    for (const msg of msgs) {
      const date = formatDate(msg.timestamp);
      if (date !== currentDate) {
        currentDate = date;
        groups.push({ date, messages: [msg] });
      } else {
        groups[groups.length - 1].messages.push(msg);
      }
    }
    return groups;
  }

  // Source badge color
  function sourceBadge(source: string) {
    switch (source) {
      case "VOCAL": return "bg-purple-500/20 text-purple-400";
      case "TEXTE": return "bg-blue-500/20 text-blue-400";
      case "WEB": return "bg-emerald-500/20 text-emerald-400";
      case "APPEL": return "bg-orange-500/20 text-orange-400";
      default: return "bg-gray-500/20 text-gray-400";
    }
  }

  // ===================== RENDER =====================

  // Loading screen
  if (loadingHistory && authStep === "password") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-[var(--jarvis-muted)]">Chargement...</div>
      </div>
    );
  }

  // Login screens
  if (authStep !== "authenticated") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--jarvis-blue)] mb-4">
              <span className="text-3xl font-bold text-white">J</span>
            </div>
            <h1 className="text-2xl font-bold text-white">Mark01</h1>
            <p className="text-[var(--jarvis-muted)] mt-1">Assistant Jarvis</p>
          </div>

          {/* Password form */}
          {authStep === "password" && (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-[var(--jarvis-muted)] mb-2">
                  Mot de passe
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-[var(--jarvis-card)] border border-[var(--jarvis-border)] rounded-xl text-white placeholder:text-[var(--jarvis-muted)] focus:outline-none focus:border-[var(--jarvis-blue)] transition-colors"
                  placeholder="Entrez votre mot de passe"
                  autoFocus
                  required
                />
              </div>
              {authError && (
                <p className="text-[var(--error-red)] text-sm">{authError}</p>
              )}
              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-3 bg-[var(--jarvis-blue)] hover:bg-blue-600 disabled:opacity-50 rounded-xl text-white font-medium transition-colors"
              >
                {authLoading ? "Verification..." : "Continuer"}
              </button>
            </form>
          )}

          {/* OTP form */}
          {authStep === "otp" && (
            <form onSubmit={handleOtpSubmit} className="space-y-4">
              <div className="text-center mb-4">
                <p className="text-[var(--jarvis-muted)] text-sm">
                  Un code a 6 chiffres a ete envoye sur votre Telegram.
                </p>
              </div>
              <div>
                <label className="block text-sm text-[var(--jarvis-muted)] mb-2">
                  Code de verification
                </label>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-full px-4 py-3 bg-[var(--jarvis-card)] border border-[var(--jarvis-border)] rounded-xl text-white text-center text-2xl tracking-[0.5em] placeholder:text-[var(--jarvis-muted)] placeholder:tracking-normal placeholder:text-base focus:outline-none focus:border-[var(--jarvis-blue)] transition-colors"
                  placeholder="000000"
                  maxLength={6}
                  autoFocus
                  required
                />
              </div>
              {authError && (
                <p className="text-[var(--error-red)] text-sm">{authError}</p>
              )}
              <button
                type="submit"
                disabled={authLoading || otp.length !== 6}
                className="w-full py-3 bg-[var(--jarvis-blue)] hover:bg-blue-600 disabled:opacity-50 rounded-xl text-white font-medium transition-colors"
              >
                {authLoading ? "Verification..." : "Se connecter"}
              </button>
              <button
                type="button"
                onClick={() => { setAuthStep("password"); setAuthError(""); setOtp(""); }}
                className="w-full py-2 text-[var(--jarvis-muted)] hover:text-white text-sm transition-colors"
              >
                Retour
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ===================== CHAT VIEW =====================

  const dateGroups = groupByDate(messages);

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--jarvis-border)] bg-[var(--jarvis-card)]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[var(--jarvis-blue)] flex items-center justify-center">
            <span className="text-lg font-bold text-white">J</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white">
              {callActive ? "APPEL EN COURS" : "JARVIS"}
            </h1>
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${callActive ? "bg-[var(--error-red)] animate-pulse-dot" : "bg-[var(--success-green)] animate-pulse-dot"}`} />
              <span className="text-xs text-[var(--jarvis-muted)]">
                {callActive
                  ? callState === "listening" ? "Ecoute..."
                  : callState === "thinking" ? "Reflexion..."
                  : callState === "speaking" ? "Parle..."
                  : "En ligne"
                  : "En ligne"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleLogout}
            className="text-xs text-[var(--jarvis-muted)] hover:text-white px-3 py-1.5 rounded-lg hover:bg-[var(--jarvis-border)] transition-colors"
          >
            Deconnexion
          </button>
        </div>
      </header>

      {/* Call mode overlay with animated orb */}
      {callActive && (
        <div className="bg-[var(--jarvis-dark)] border-b border-[var(--jarvis-border)] px-4 py-8 flex flex-col items-center gap-4">
          {/* Orbe Jarvis */}
          <div className={`jarvis-orb ${
            callState === "listening" ? "orb-listening" :
            callState === "thinking" ? "orb-thinking" :
            callState === "speaking" ? "orb-speaking" :
            "orb-idle"
          }`}>
            <div className="jarvis-orb-glow" />
            <div className="jarvis-orb-ring-3" />
            <div className="jarvis-orb-ring-2" />
            <div className="jarvis-orb-ring" />
            <div className="jarvis-orb-core" />
          </div>

          <p className="text-sm text-[var(--jarvis-muted)] mt-2">
            {callState === "listening" ? "Je vous ecoute..." :
             callState === "thinking" ? "Reflexion en cours..." :
             callState === "speaking" ? "Jarvis repond..." :
             "Mode appel actif"}
          </p>
          {callTranscript && callState === "listening" && (
            <p className="text-xs text-[var(--jarvis-text)] bg-[var(--jarvis-card)] px-4 py-2 rounded-xl max-w-sm text-center border border-[var(--jarvis-border)]">
              &laquo; {callTranscript} &raquo;
            </p>
          )}
          <button
            onClick={endCallMode}
            className="mt-1 px-6 py-2.5 bg-[var(--error-red)] hover:bg-red-700 rounded-full text-white font-medium text-sm transition-colors"
          >
            Raccrocher
          </button>
          <p className="text-[10px] text-[var(--jarvis-muted)]">
            Dites &laquo; raccroche &raquo; ou &laquo; au revoir &raquo; pour terminer
          </p>
        </div>
      )}

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-2xl bg-[var(--jarvis-blue)]/10 flex items-center justify-center mb-4">
              <span className="text-3xl">🤖</span>
            </div>
            <h2 className="text-lg font-semibold text-white mb-2">Bienvenue</h2>
            <p className="text-[var(--jarvis-muted)] text-sm max-w-xs">
              Ecrivez un message pour commencer une conversation avec Jarvis.
              L&apos;historique est partage avec votre application mobile.
            </p>
          </div>
        )}

        {dateGroups.map((group) => (
          <div key={group.date}>
            {/* Date separator */}
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-[var(--jarvis-border)]" />
              <span className="text-xs text-[var(--jarvis-muted)] font-medium">
                {group.date}
              </span>
              <div className="flex-1 h-px bg-[var(--jarvis-border)]" />
            </div>

            {/* Messages */}
            {group.messages.map((msg) => (
              <div key={msg.id} className="mb-4">
                {/* User message */}
                <div className="flex justify-end mb-1.5">
                  <div className="max-w-[80%]">
                    <div className="flex items-center justify-end gap-2 mb-1">
                      <span className="text-[10px] text-[var(--jarvis-muted)]">
                        {formatTime(msg.timestamp)}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${sourceBadge(msg.source)}`}>
                        {msg.source}
                      </span>
                    </div>
                    <div className="bg-[var(--jarvis-blue)] text-white px-4 py-2.5 rounded-2xl rounded-br-md text-sm">
                      {msg.userMessage}
                    </div>
                  </div>
                </div>

                {/* Jarvis response */}
                <div className="flex justify-start">
                  <div className="max-w-[80%]">
                    <div className="bg-[var(--jarvis-card)] border border-[var(--jarvis-border)] text-[var(--jarvis-text)] px-4 py-2.5 rounded-2xl rounded-bl-md text-sm whitespace-pre-wrap">
                      {msg.jarvisResponse || (
                        <span className="flex gap-1">
                          <span className="typing-dot w-2 h-2 bg-[var(--jarvis-muted)] rounded-full inline-block" />
                          <span className="typing-dot w-2 h-2 bg-[var(--jarvis-muted)] rounded-full inline-block" />
                          <span className="typing-dot w-2 h-2 bg-[var(--jarvis-muted)] rounded-full inline-block" />
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSend}
        className="flex items-center gap-2 p-3 border-t border-[var(--jarvis-border)] bg-[var(--jarvis-card)]"
      >
        {/* Bouton Appel */}
        <button
          type="button"
          onClick={toggleCallMode}
          className={`w-10 h-10 rounded-full flex items-center justify-center text-lg transition-all shrink-0 ${
            callActive
              ? "bg-[var(--error-red)] text-white animate-pulse"
              : "bg-[var(--jarvis-dark)] text-[var(--success-green)] border border-[var(--success-green)]/30 hover:border-[var(--success-green)] hover:bg-[var(--success-green)]/10"
          }`}
          title={callActive ? "Raccrocher" : "Mode Appel"}
        >
          📞
        </button>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ecrivez a Jarvis..."
          disabled={sending || callActive}
          className="flex-1 px-4 py-2.5 bg-[var(--jarvis-dark)] border border-[var(--jarvis-border)] rounded-xl text-white placeholder:text-[var(--jarvis-muted)] focus:outline-none focus:border-[var(--jarvis-blue)] transition-colors disabled:opacity-50"
          autoFocus
        />
        <button
          type="submit"
          disabled={sending || !input.trim() || callActive}
          className="px-5 py-2.5 bg-[var(--jarvis-blue)] hover:bg-blue-600 disabled:opacity-30 rounded-xl text-white font-medium transition-colors"
        >
          {sending ? "..." : "Envoyer"}
        </button>
      </form>
    </div>
  );
}
