"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface ChatMessage {
  id: string;
  source: "TEXTE" | "VOCAL" | "WEB" | "APPEL";
  userMessage: string;
  jarvisResponse: string;
  timestamp: number;
}

interface Agent {
  id: string;
  label: string;
  description: string;
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

  // Agent state
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeAgentId, setActiveAgentId] = useState("jarvis");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("sidebar_collapsed") === "true";
    }
    return false;
  });
  const [switchingAgent, setSwitchingAgent] = useState(false);

  // Create agent modal
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [newAgentId, setNewAgentId] = useState("");
  const [newAgentLabel, setNewAgentLabel] = useState("");
  const [newAgentDesc, setNewAgentDesc] = useState("");
  const [newAgentSystem, setNewAgentSystem] = useState("");
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [createAgentError, setCreateAgentError] = useState("");

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [pendingImageName, setPendingImageName] = useState<string | null>(null);
  const [pendingFileType, setPendingFileType] = useState<string>("image/jpeg");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Call mode state
  const [callActive, setCallActive] = useState(false);
  const [callState, setCallState] = useState<CallState>("idle");
  const [callTranscript, setCallTranscript] = useState("");
  const [callMenuOpen, setCallMenuOpen] = useState(false);
  const [callBucketId, setCallBucketId] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const callActiveRef = useRef(false);
  const callLoopRunning = useRef(false);
  const callBucketRef = useRef<string | null>(null);

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

  // Close call menu on outside click
  useEffect(() => {
    if (!callMenuOpen) return;
    function handleClick() { setCallMenuOpen(false); }
    const timer = setTimeout(() => document.addEventListener("click", handleClick), 0);
    return () => { clearTimeout(timer); document.removeEventListener("click", handleClick); };
  }, [callMenuOpen]);

  // Load agents list
  async function loadAgents(token: string) {
    try {
      const res = await fetch("/api/agents", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const agentList: Agent[] = (data.agents || []).map((a: { id: string; label: string; description?: string }) => ({
          id: a.id,
          label: a.label,
          description: a.description || "",
        }));
        setAgents(agentList);
      }
    } catch {
      // Silently fail - sidebar will be empty
    }
  }

  // Switch agent
  async function switchAgent(agentId: string) {
    if (agentId === activeAgentId || !authToken) return;
    setSwitchingAgent(true);
    setActiveAgentId(agentId);
    setSidebarOpen(false);
    setMessages([]);
    await loadChatHistory(authToken, agentId);
    setSwitchingAgent(false);
  }

  // Create new agent
  async function handleCreateAgent(e: React.FormEvent) {
    e.preventDefault();
    if (!authToken || !newAgentId.trim() || !newAgentLabel.trim()) return;
    setCreatingAgent(true);
    setCreateAgentError("");

    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          id: newAgentId.trim(),
          label: newAgentLabel.trim(),
          description: newAgentDesc.trim(),
          system: newAgentSystem.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setShowCreateAgent(false);
        setNewAgentId("");
        setNewAgentLabel("");
        setNewAgentDesc("");
        setNewAgentSystem("");
        await loadAgents(authToken);
        if (data.agent?.id) {
          switchAgent(data.agent.id);
        }
      } else {
        setCreateAgentError(data.error || "Erreur inconnue");
      }
    } catch {
      setCreateAgentError("Erreur de connexion");
    }
    setCreatingAgent(false);
  }

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
        loadAgents(token);
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
        loadAgents(data.token);
      } else {
        setAuthError(data.error || "Code invalide");
      }
    } catch {
      setAuthError("Erreur de connexion");
    }
    setAuthLoading(false);
  }

  // Load chat history
  const loadChatHistory = useCallback(async (token: string, agentId?: string) => {
    const effectiveAgentId = agentId || "jarvis";
    try {
      const res = await fetch(`/api/chat?agentId=${effectiveAgentId}`, {
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

  // Handle file selection (image or PDF)
  const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!allowedTypes.includes(file.type)) {
      alert("Format non supporte. Utilisez une image (JPG, PNG, GIF, WebP) ou un PDF.");
      e.target.value = "";
      return;
    }
    const maxSize = file.type === "application/pdf" ? 20 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      alert(`Fichier trop volumineux (max ${file.type === "application/pdf" ? "20" : "10"} Mo)`);
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      setPendingImage(base64);
      setPendingImageName(file.name);
      setPendingFileType(file.type);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function clearPendingImage() {
    setPendingImage(null);
    setPendingImageName(null);
    setPendingFileType("image/jpeg");
  }

  // Send message
  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending || !authToken) return;

    const userMsg = input.trim();
    const imageToSend = pendingImage;
    const imageName = pendingImageName;
    const fileType = pendingFileType;
    setInput("");
    setPendingImage(null);
    setPendingImageName(null);
    setPendingFileType("image/jpeg");
    setSending(true);

    // Ajouter le message utilisateur immediatement
    const tempId = `temp-${Date.now()}`;
    const displayMsg = imageToSend ? `[${imageName}] ${userMsg}` : userMsg;
    const newMsg: ChatMessage = {
      id: tempId,
      source: "WEB",
      userMessage: displayMsg,
      jarvisResponse: "",
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, newMsg]);

    try {
      const bodyPayload: Record<string, string> = { message: userMsg, agentId: activeAgentId };
      if (imageToSend) {
        bodyPayload.image = imageToSend;
        bodyPayload.imageType = fileType;
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(bodyPayload),
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

  // Init speech synthesis + precharger les voix
  const jarvisVoiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    synthRef.current = window.speechSynthesis;

    function selectBestVoice() {
      const synth = synthRef.current;
      if (!synth) return;
      const voices = synth.getVoices();
      if (voices.length === 0) return;

      // Filtrer les voix fr-FR
      const frFR = voices.filter(v => v.lang === "fr-FR");
      const frAll = voices.filter(v => v.lang.startsWith("fr"));

      // Log pour debug
      console.log("[Jarvis TTS] Voix disponibles:", frAll.map(v =>
        `${v.name} (${v.lang}, ${v.localService ? "local" : "reseau"})`
      ));

      // Priorite 1 : Voix reseau Google fr-FR (la plus naturelle)
      const googleNetwork = frFR.find(v =>
        v.name.toLowerCase().includes("google") && !v.localService
      );
      if (googleNetwork) {
        jarvisVoiceRef.current = googleNetwork;
        console.log("[Jarvis TTS] Selectionnee:", googleNetwork.name, "(Google reseau)");
        return;
      }

      // Priorite 2 : N'importe quelle voix reseau fr-FR (plus naturelle que locale)
      const anyNetwork = frFR.find(v => !v.localService);
      if (anyNetwork) {
        jarvisVoiceRef.current = anyNetwork;
        console.log("[Jarvis TTS] Selectionnee:", anyNetwork.name, "(reseau)");
        return;
      }

      // Priorite 3 : Voix locale fr-FR avec noms preferes (masculin / meilleure qualite)
      const preferredKeywords = ["male", "homme", "thomas", "pierre", "nicolas", "mathieu"];
      const preferredLocal = frFR.find(v =>
        preferredKeywords.some(k => v.name.toLowerCase().includes(k))
      );
      if (preferredLocal) {
        jarvisVoiceRef.current = preferredLocal;
        console.log("[Jarvis TTS] Selectionnee:", preferredLocal.name, "(locale preferee)");
        return;
      }

      // Priorite 4 : Premiere voix fr-FR locale
      if (frFR.length > 0) {
        jarvisVoiceRef.current = frFR[0];
        console.log("[Jarvis TTS] Selectionnee:", frFR[0].name, "(fr-FR fallback)");
        return;
      }

      // Priorite 5 : N'importe quelle voix francaise
      if (frAll.length > 0) {
        jarvisVoiceRef.current = frAll[0];
        console.log("[Jarvis TTS] Selectionnee:", frAll[0].name, "(fr fallback)");
      }
    }

    // Les voix peuvent ne pas etre chargees immediatement
    selectBestVoice();
    window.speechSynthesis.onvoiceschanged = selectBestVoice;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  // TTS: prononcer un texte via OpenAI TTS (fallback navigateur)
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  async function speakText(text: string): Promise<void> {
    // Arreter tout audio en cours
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
    }
    synthRef.current?.cancel();

    // Tenter OpenAI TTS via /api/tts
    if (authToken) {
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${authToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text, voice: "onyx" }),
        });

        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          return new Promise((resolve) => {
            const audio = new Audio(url);
            ttsAudioRef.current = audio;
            audio.onended = () => {
              URL.revokeObjectURL(url);
              ttsAudioRef.current = null;
              resolve();
            };
            audio.onerror = () => {
              URL.revokeObjectURL(url);
              ttsAudioRef.current = null;
              resolve();
            };
            audio.play().catch(() => resolve());
          });
        }
      } catch {
        // Fallback vers TTS navigateur
      }
    }

    // Fallback: SpeechSynthesis du navigateur
    return new Promise((resolve) => {
      const synth = synthRef.current;
      if (!synth) { resolve(); return; }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "fr-FR";
      utterance.rate = 1.05;
      utterance.pitch = 0.95;

      if (jarvisVoiceRef.current) {
        utterance.voice = jarvisVoiceRef.current;
      }

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

        // Envoyer a l'agent (ou bucket)
        setCallState("thinking");
        const targetAgentId = callBucketRef.current || activeAgentId;

        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ message: command.trim(), source: "APPEL", agentId: targetAgentId }),
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

  // Demarrer le mode appel (normal ou bucket)
  function startCallMode(bucketId?: string) {
    if (!authToken) return;
    callActiveRef.current = true;
    callBucketRef.current = bucketId || null;
    setCallBucketId(bucketId || null);
    setCallActive(true);
    setCallState("listening");
    setCallMenuOpen(false);

    const bucketLabels: Record<string, string> = {
      "bucket-brainstorming": "brainstorming",
      "bucket-todo": "prise de notes de taches",
      "bucket-reunion": "compte-rendu de reunion",
    };
    const label = bucketId ? bucketLabels[bucketId] || bucketId : "appel";
    speakText(`Mode ${label} active. Je t'ecoute.`).then(() => {
      callModeLoop(authToken);
    });
  }

  // Arreter le mode appel
  function endCallMode() {
    callActiveRef.current = false;
    callBucketRef.current = null;
    setCallActive(false);
    setCallBucketId(null);
    setCallState("idle");
    setCallTranscript("");
    setCallMenuOpen(false);

    recognitionRef.current?.abort();
    synthRef.current?.cancel();
  }

  // Toggle mode appel : si actif -> raccrocher, sinon -> ouvrir le menu
  function toggleCallMode() {
    if (callActive) {
      endCallMode();
    } else {
      setCallMenuOpen(!callMenuOpen);
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
  const activeAgent = agents.find(a => a.id === activeAgentId);
  const activeLabel = activeAgent?.label || activeAgentId.charAt(0).toUpperCase() + activeAgentId.slice(1);

  // Icones par agent
  const agentIcons: Record<string, string> = {
    jarvis: "\u{1F916}",
    paybrain: "\u{1F4B3}",
    "paybrain-app": "\u{1F4F1}",
    "paybrain-tpe": "\u{1F3EA}",
    comptaapp: "\u{1F4CA}",
    salesbrain: "\u{1F4C8}",
    blockbrain: "\u{26D3}\uFE0F",
    "businessplan-paybrain": "\u{1F4CB}",
    tradebrain: "\u{1F4B9}",
    swapdf: "\u{1F4C4}",
    aifc: "🥊",
    "bucket-brainstorming": "\u{1F4A1}",
    "bucket-todo": "\u{2705}",
    "bucket-reunion": "\u{1F4DD}",
  };

  function getAgentIcon(id: string) {
    return agentIcons[id] || "\u{1F4AC}";
  }

  // Separer les agents normaux et les buckets memoire
  const bucketIds = ["bucket-brainstorming", "bucket-todo", "bucket-reunion"];
  const bucketAgents = agents.filter(a => bucketIds.includes(a.id));
  const regularAgents = agents.filter(a => !bucketIds.includes(a.id));

  // Trier : Jarvis en premier, puis alphabetique
  const sortedAgents = [...regularAgents].sort((a, b) => {
    if (a.id === "jarvis") return -1;
    if (b.id === "jarvis") return 1;
    return a.label.localeCompare(b.label);
  });

  function toggleSidebarCollapse() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    localStorage.setItem("sidebar_collapsed", String(next));
  }

  return (
    <div className="h-screen flex">
      {/* Sidebar overlay mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <div className="p-3 border-b border-[var(--jarvis-border)] flex items-center sidebar-header-content gap-2">
          <h2 className="sidebar-header-text text-xs font-semibold text-[var(--jarvis-muted)] uppercase tracking-wider flex-1">Agents</h2>
          <button
            onClick={() => setShowCreateAgent(true)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--jarvis-muted)] hover:text-[var(--success-green)] hover:bg-[var(--jarvis-border)]/50 transition-colors shrink-0"
            title="Creer un agent"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            onClick={toggleSidebarCollapse}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--jarvis-muted)] hover:text-white hover:bg-[var(--jarvis-border)]/50 transition-colors shrink-0 hidden md:flex"
            title={sidebarCollapsed ? "Agrandir" : "Reduire"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {sidebarCollapsed ? (
                <><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></>
              ) : (
                <><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></>
              )}
            </svg>
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          {sortedAgents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => switchAgent(agent.id)}
              title={sidebarCollapsed ? `${agent.label} - ${agent.description}` : undefined}
              className={`sidebar-agent-btn w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                agent.id === activeAgentId
                  ? "bg-[var(--jarvis-blue)]/15 text-white"
                  : "text-[var(--jarvis-muted)] hover:bg-[var(--jarvis-border)]/50 hover:text-white"
              }`}
            >
              <span className="text-xl shrink-0" role="img">{getAgentIcon(agent.id)}</span>
              <div className="sidebar-text min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{agent.label}</div>
                <div className="text-[10px] text-[var(--jarvis-muted)] truncate">{agent.description}</div>
              </div>
              {agent.id === activeAgentId && (
                <div className="sidebar-text w-2 h-2 rounded-full bg-[var(--jarvis-blue)] shrink-0 ml-auto" />
              )}
            </button>
          ))}
          {agents.length === 0 && (
            <div className="text-xs text-[var(--jarvis-muted)] text-center py-4">...</div>
          )}
        </nav>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--jarvis-border)] bg-[var(--jarvis-card)]">
          <div className="flex items-center gap-3">
            {/* Hamburger menu mobile */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="w-9 h-9 rounded-xl bg-[var(--jarvis-dark)] flex items-center justify-center md:hidden border border-[var(--jarvis-border)]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <span className="text-2xl" role="img">{getAgentIcon(activeAgentId)}</span>
            <div>
              <h1 className="text-sm font-semibold text-white">
                {callActive ? "APPEL EN COURS" : activeLabel.toUpperCase()}
              </h1>
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${callActive ? "bg-[var(--error-red)] animate-pulse-dot" : switchingAgent ? "bg-[var(--warning-orange)] animate-pulse-dot" : "bg-[var(--success-green)] animate-pulse-dot"}`} />
                <span className="text-xs text-[var(--jarvis-muted)]">
                  {switchingAgent ? "Chargement..."
                    : callActive
                    ? callState === "listening" ? "Ecoute..."
                    : callState === "thinking" ? "Reflexion..."
                    : callState === "speaking" ? "Parle..."
                    : "En ligne"
                    : "En ligne"}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {bucketAgents.map((bucket) => (
              <button
                key={bucket.id}
                onClick={() => switchAgent(bucket.id)}
                title={bucket.label}
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-base transition-all ${
                  bucket.id === activeAgentId
                    ? "bg-[var(--jarvis-blue)]/20 ring-1 ring-[var(--jarvis-blue)]"
                    : "hover:bg-[var(--jarvis-border)]/50"
                }`}
              >
                {getAgentIcon(bucket.id)}
              </button>
            ))}
            {bucketAgents.length > 0 && (
              <div className="w-px h-5 bg-[var(--jarvis-border)] mx-1" />
            )}
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

          {callBucketId && (
            <div className="flex items-center gap-2 bg-[var(--jarvis-card)] px-3 py-1.5 rounded-full border border-[var(--jarvis-border)]">
              <span className="text-sm">{getAgentIcon(callBucketId)}</span>
              <span className="text-xs text-[var(--jarvis-text)] font-medium">
                {callBucketId === "bucket-brainstorming" ? "Brainstorming" : callBucketId === "bucket-todo" ? "A Faire" : "Reunion"}
              </span>
            </div>
          )}
          <p className="text-sm text-[var(--jarvis-muted)] mt-2">
            {callState === "listening" ? "Je vous ecoute..." :
             callState === "thinking" ? "Reflexion en cours..." :
             callState === "speaking" ? (callBucketId ? "Enregistrement..." : `${activeLabel} repond...`) :
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
              Ecrivez un message pour commencer une conversation avec {activeLabel}.
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

      {/* Pending file preview */}
      {pendingImage && (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-[var(--jarvis-border)] bg-[var(--jarvis-dark)]">
          <div className="w-10 h-10 rounded-lg bg-[var(--jarvis-card)] border border-[var(--jarvis-border)] flex items-center justify-center overflow-hidden">
            {pendingFileType === "application/pdf" ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--error-red)" strokeWidth="1.5" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="9" y1="15" x2="15" y2="15" />
                <line x1="9" y1="11" x2="15" y2="11" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--jarvis-muted)" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
            )}
          </div>
          <span className="text-xs text-[var(--jarvis-muted)] truncate flex-1">{pendingImageName}</span>
          <button
            type="button"
            onClick={clearPendingImage}
            className="text-[var(--jarvis-muted)] hover:text-[var(--error-red)] text-lg transition-colors"
            title="Supprimer l'image"
          >
            &times;
          </button>
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={handleSend}
        className="flex items-center gap-2 p-3 border-t border-[var(--jarvis-border)] bg-[var(--jarvis-card)]"
      >
        {/* Bouton Appel + Menu */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={toggleCallMode}
            className={`w-10 h-10 rounded-full flex items-center justify-center text-lg transition-all ${
              callActive
                ? "bg-[var(--error-red)] text-white animate-pulse"
                : callMenuOpen
                ? "bg-[var(--success-green)]/20 text-[var(--success-green)] border border-[var(--success-green)]"
                : "bg-[var(--jarvis-dark)] text-[var(--success-green)] border border-[var(--success-green)]/30 hover:border-[var(--success-green)] hover:bg-[var(--success-green)]/10"
            }`}
            title={callActive ? "Raccrocher" : "Mode Appel / Buckets"}
          >
            {callActive ? "\u{1F4F5}" : "\u{1F4DE}"}
          </button>

          {/* Menu contextuel */}
          {callMenuOpen && !callActive && (
            <div className="absolute bottom-12 left-0 bg-[var(--jarvis-card)] border border-[var(--jarvis-border)] rounded-xl shadow-xl py-1 w-56 z-50">
              <button
                type="button"
                onClick={() => startCallMode()}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--jarvis-text)] hover:bg-[var(--jarvis-border)]/50 transition-colors"
              >
                <span className="text-lg">{"\u{1F4DE}"}</span>
                <div>
                  <div className="font-medium">Appel {activeLabel}</div>
                  <div className="text-[10px] text-[var(--jarvis-muted)]">Conversation vocale</div>
                </div>
              </button>
              <div className="h-px bg-[var(--jarvis-border)] mx-3 my-1" />
              <div className="px-4 py-1">
                <span className="text-[10px] text-[var(--jarvis-muted)] uppercase tracking-wider">Buckets</span>
              </div>
              <button
                type="button"
                onClick={() => startCallMode("bucket-brainstorming")}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--jarvis-text)] hover:bg-[var(--jarvis-border)]/50 transition-colors"
              >
                <span className="text-lg">{"\u{1F4A1}"}</span>
                <div>
                  <div className="font-medium">Brainstorming</div>
                  <div className="text-[10px] text-[var(--jarvis-muted)]">Capture d&apos;idees</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => startCallMode("bucket-todo")}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--jarvis-text)] hover:bg-[var(--jarvis-border)]/50 transition-colors"
              >
                <span className="text-lg">{"\u{2705}"}</span>
                <div>
                  <div className="font-medium">A Faire</div>
                  <div className="text-[10px] text-[var(--jarvis-muted)]">Capture de taches</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => startCallMode("bucket-reunion")}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--jarvis-text)] hover:bg-[var(--jarvis-border)]/50 transition-colors"
              >
                <span className="text-lg">{"\u{1F4DD}"}</span>
                <div>
                  <div className="font-medium">Reunion</div>
                  <div className="text-[10px] text-[var(--jarvis-muted)]">Compte-rendu</div>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Bouton Fichier (Image + PDF) */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending || callActive}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all shrink-0 ${
            pendingImage
              ? "bg-[var(--jarvis-blue)]/20 text-[var(--jarvis-blue)] border border-[var(--jarvis-blue)]/40"
              : "bg-[var(--jarvis-dark)] text-[var(--jarvis-muted)] border border-[var(--jarvis-border)] hover:text-white hover:border-[var(--jarvis-muted)]"
          } disabled:opacity-30`}
          title="Joindre un fichier (image ou PDF)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </button>

        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={pendingImage ? (pendingFileType === "application/pdf" ? `Question sur le PDF pour ${activeLabel}...` : `Decrivez l'image pour ${activeLabel}...`) : `Ecrivez a ${activeLabel}...`}
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

      {/* Modal creation d'agent */}
      {showCreateAgent && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowCreateAgent(false)}>
          <div className="bg-[var(--jarvis-card)] border border-[var(--jarvis-border)] rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-[var(--jarvis-border)]">
              <h3 className="text-lg font-semibold text-white">Nouvel agent</h3>
              <p className="text-xs text-[var(--jarvis-muted)] mt-1">Creez un agent specialise avec son propre systeme et historique.</p>
            </div>
            <form onSubmit={handleCreateAgent} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--jarvis-muted)] mb-1">ID (slug)</label>
                  <input
                    type="text"
                    value={newAgentId}
                    onChange={(e) => setNewAgentId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                    placeholder="mon-agent"
                    className="w-full px-3 py-2 bg-[var(--jarvis-dark)] border border-[var(--jarvis-border)] rounded-lg text-white text-sm placeholder:text-[var(--jarvis-muted)] focus:outline-none focus:border-[var(--jarvis-blue)]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--jarvis-muted)] mb-1">Nom</label>
                  <input
                    type="text"
                    value={newAgentLabel}
                    onChange={(e) => setNewAgentLabel(e.target.value)}
                    placeholder="Mon Agent"
                    className="w-full px-3 py-2 bg-[var(--jarvis-dark)] border border-[var(--jarvis-border)] rounded-lg text-white text-sm placeholder:text-[var(--jarvis-muted)] focus:outline-none focus:border-[var(--jarvis-blue)]"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-[var(--jarvis-muted)] mb-1">Description</label>
                <input
                  type="text"
                  value={newAgentDesc}
                  onChange={(e) => setNewAgentDesc(e.target.value)}
                  placeholder="Agent specialise en..."
                  className="w-full px-3 py-2 bg-[var(--jarvis-dark)] border border-[var(--jarvis-border)] rounded-lg text-white text-sm placeholder:text-[var(--jarvis-muted)] focus:outline-none focus:border-[var(--jarvis-blue)]"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--jarvis-muted)] mb-1">Instructions systeme (optionnel)</label>
                <textarea
                  value={newAgentSystem}
                  onChange={(e) => setNewAgentSystem(e.target.value)}
                  placeholder="Tu es un expert en... Tu dois toujours..."
                  rows={4}
                  className="w-full px-3 py-2 bg-[var(--jarvis-dark)] border border-[var(--jarvis-border)] rounded-lg text-white text-sm placeholder:text-[var(--jarvis-muted)] focus:outline-none focus:border-[var(--jarvis-blue)] resize-none"
                />
              </div>
              {createAgentError && (
                <p className="text-[var(--error-red)] text-sm">{createAgentError}</p>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowCreateAgent(false)}
                  className="px-4 py-2 text-sm text-[var(--jarvis-muted)] hover:text-white rounded-lg hover:bg-[var(--jarvis-border)]/50 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={creatingAgent || !newAgentId.trim() || !newAgentLabel.trim()}
                  className="px-4 py-2 text-sm bg-[var(--jarvis-blue)] hover:bg-blue-600 disabled:opacity-40 rounded-lg text-white font-medium transition-colors"
                >
                  {creatingAgent ? "Creation..." : "Creer l'agent"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
