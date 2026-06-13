import { useState, useEffect, useRef, KeyboardEvent } from "react";
import { io, Socket } from "socket.io-client";
import { motion, AnimatePresence } from "motion/react";
import { Message, AppState } from "./types";
import VideoPlayer from "./components/VideoPlayer";
import ChatPanel from "./components/ChatPanel";
import AdContainer from "./components/AdContainer";
import { initGA, trackEvent } from "./utils/analytics";
import { 
  Users, 
  Sparkles, 
  ShieldCheck, 
  Video, 
  MessageSquare, 
  Plus, 
  X, 
  Lock, 
  Activity, 
  Share2, 
  Tv,
  Info,
  ArrowLeft
} from "lucide-react";

const POPULAR_SUGGESTIONS = [
  "gaming", "music", "coding", "movies", "anime", "books", "art", "sports", "tech", "singing"
];

export default function App() {
  // Core Selection Preferences
  const [interests, setInterests] = useState<string[]>([]);
  const [interestInput, setInterestInput] = useState("");
  const [mode, setMode] = useState<"text" | "video">("text");
  const [autoConnect, setAutoConnect] = useState<boolean>(true);

  // Multi-user & Pairing state machine
  const [appState, setAppState] = useState<AppState>("landing");
  const [onlineCount, setOnlineCount] = useState<number>(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [commonInterests, setCommonInterests] = useState<string[]>([]);
  const [strangerIsTyping, setStrangerIsTyping] = useState<boolean>(false);
  const [partnerId, setPartnerId] = useState<string | null>(null);

  // Terms and conditions agreement states
  const [agreedToTerms, setAgreedToTerms] = useState<boolean>(false);
  const [showTermsDetail, setShowTermsDetail] = useState<boolean>(false);
  const [showPrivacyDetail, setShowPrivacyDetail] = useState<boolean>(false);

  // WebRTC Stream configurations
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [isStreamLoading, setIsStreamLoading] = useState(false);

  // References
  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const modeRef = useRef<"text" | "video">(mode);
  const partnerIdRef = useRef<string | null>(partnerId);
  const signalQueueRef = useRef<{ candidate?: any; offer?: any; answer?: any }[]>([]);

  // Sync refs to avoid stale closures in socket events
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const autoConnectRef = useRef<boolean>(autoConnect);

  useEffect(() => {
    partnerIdRef.current = partnerId;
  }, [partnerId]);

  useEffect(() => {
    autoConnectRef.current = autoConnect;
  }, [autoConnect]);

  // Auto-connect to global socket statistics update on layout spawn
  useEffect(() => {
    initGA();
    initSocketConnection();
    return () => {
      disconnectActiveSockets();
    };
  }, []);

  // Update stream references for WebRTC matching callbacks
  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  // Handle client-side interest priority fallback messaging
  useEffect(() => {
    if (appState === "searching" && interests.length > 0) {
      const timer = setTimeout(() => {
        addSystemMessage("No common interest partner found within 5 seconds. Widening search to all online strangers...");
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [appState, interests]);

  // Process queued WebRTC signaling messages safely
  const processSignalQueue = async () => {
    const pc = pcRef.current;
    if (!pc) return;

    const queue = [...signalQueueRef.current];
    signalQueueRef.current = [];

    for (const signal of queue) {
      try {
        if (signal.offer) {
          console.log("[WebRTC] Processing queued offer");
          await pc.setRemoteDescription(new RTCSessionDescription(signal.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socketRef.current?.emit("webrtc-signal", {
            to: partnerIdRef.current || "",
            signal: { answer }
          });
        } else if (signal.answer) {
          console.log("[WebRTC] Processing queued answer");
          await pc.setRemoteDescription(new RTCSessionDescription(signal.answer));
        } else if (signal.candidate) {
          if (pc.remoteDescription && pc.remoteDescription.type) {
            console.log("[WebRTC] Processing queued candidate");
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } else {
            // Re-queue candidate if remote desc is still not set
            signalQueueRef.current.push(signal);
          }
        }
      } catch (err) {
        console.error("Error processing queued signaling item: ", err);
      }
    }
  };

  // Lazy instantiate socket.io client
  const initSocketConnection = () => {
    if (socketRef.current) return;

    // Connect to same origin path (works seamlessly on dev workspace and in production Cloud Run)
    const socket = io({
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
    });
    socketRef.current = socket;

    // Receive global user counts
    socket.on("stats-update", ({ count }: { count: number }) => {
      setOnlineCount(count);
    });

    // Match established callback
    socket.on("paired", async ({ peerId, initiator, commonInterests: common }) => {
      partnerIdRef.current = peerId; // STABILIZE REF SYNCHRONOUSLY!
      setPartnerId(peerId);
      setCommonInterests(common);
      setAppState("paired");
      setStrangerIsTyping(false);

      trackEvent("match_connected", {
        mode: modeRef.current,
        initiator,
        common_interests_count: common.length,
        common_interests: common,
      });

      addSystemMessage("Stranger connected!");
      if (common.length > 0) {
        addSystemMessage(`You share common interest(s): ${common.join(", ")}`);
      } else {
        addSystemMessage("Searching found a random stranger.");
      }

      // If user selected Video mode, instantly negotiate WebRTC peer stream
      if (modeRef.current === "video") {
        await initiateWebRTCPeer(peerId, initiator);
      }
    });

    // Handle instant incoming messages
    socket.on("chat-message", ({ text }: { text: string }) => {
      addMessage("stranger", text);
    });

    // Handle typing status indications
    socket.on("typing", ({ isTyping }: { isTyping: boolean }) => {
      setStrangerIsTyping(isTyping);
    });

    // WebRTC signaling relay callback
    socket.on("webrtc-signal", async ({ from, signal }) => {
      const currentPartner = partnerIdRef.current;
      if (from !== currentPartner) {
        return;
      }

      const pc = pcRef.current;
      if (!pc) {
        // Queue the signal if peer connection is not yet initialized
        signalQueueRef.current.push(signal);
        return;
      }

      try {
        if (signal.offer) {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socketRef.current?.emit("webrtc-signal", {
            to: from,
            signal: { answer }
          });
          // Process queued items (like candidates)
          await processSignalQueue();
        } else if (signal.answer) {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.answer));
          // Process queued items (like candidates)
          await processSignalQueue();
        } else if (signal.candidate) {
          if (pc.remoteDescription && pc.remoteDescription.type) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } else {
            // Queue candidate until remote description has been set
            signalQueueRef.current.push(signal);
          }
        }
      } catch (err) {
        console.error("WebRTC Signaling Error: ", err);
      }
    });

    // Handle sudden stranger disconnects or leaves
    socket.on("stranger-disconnected", () => {
      addSystemMessage("Stranger has disconnected.");
      cleanPeerConnection();
      trackEvent("match_disconnected", { mode: modeRef.current });
      if (autoConnectRef.current) {
        addSystemMessage("Auto-Connecting with a new stranger in 1.5 seconds...");
        setTimeout(() => {
          handleSkipMatch();
        }, 1500);
      } else {
        setAppState("idle");
        addSystemMessage("Connection paused. Refine your interests or click Resume/Connect to start matching.");
      }
    });

    // Socket fallback status logs
    socket.on("disconnect", () => {
      addSystemMessage("Lost connection to server. Retrying...");
      cleanPeerConnection();
      setAppState("idle");
    });
  };

  const disconnectActiveSockets = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    cleanPeerConnection();
    stopLocalMediaStream();
  };

  // Helper to add chat bubble
  const addMessage = (sender: "you" | "stranger" | "system", text: string) => {
    const newMsg: Message = {
      id: Math.random().toString(36).substring(7),
      sender,
      text,
      timestamp: new Date()
    };
    setMessages((prev) => [...prev, newMsg]);
  };

  const addSystemMessage = (text: string) => {
    addMessage("system", text);
  };

  // Safe request camera/mic feeds
  const requestLocalStream = async (): Promise<MediaStream | null> => {
    setIsStreamLoading(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user"
        },
        audio: true
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setCameraActive(true);
      setMicActive(true);
      return stream;
    } catch (err) {
      console.warn("High-quality media stream denied, attempting standard video+audio fallback...", err);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        setLocalStream(stream);
        setCameraActive(true);
        setMicActive(true);
        return stream;
      } catch (err15) {
        console.warn("Standard video+audio fallback failed, attempting video-only/voice fallbacks...", err15);
        try {
          // Fallback 1: Video-only if microphone is blocked or missing
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          localStreamRef.current = stream;
          setLocalStream(stream);
          setCameraActive(true);
          setMicActive(false);
          return stream;
        } catch (err2) {
          try {
            // Fallback 2: Audio-only if webcam is blocked or missing
            const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
            localStreamRef.current = stream;
            setLocalStream(stream);
            setCameraActive(false);
            setMicActive(true);
            return stream;
          } catch (err3) {
            console.error("All camera and microphone hardware tracks denied entirely.", err3);
            localStreamRef.current = null;
            setLocalStream(null);
            setCameraActive(false);
            setMicActive(false);
            return null;
          }
        }
      }
    } finally {
      setIsStreamLoading(false);
    }
  };

  const stopLocalMediaStream = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }
    setCameraActive(false);
    setMicActive(false);
  };

  // WebRTC Peer connection signaling & establishment
  const initiateWebRTCPeer = async (peerSocketId: string, isInitiator: boolean) => {
    // Clean existing peer connection and remote stream without resetting the partner ID
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch (e) {
        console.warn("Error closing old PeerConnection", e);
      }
      pcRef.current = null;
    }
    setRemoteStream(null);

    // Standard STUN servers for robust NAT traversals
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun.services.mozilla.com" }
      ]
    });

    pcRef.current = pc;

    // Monitor WebRTC states
    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE Connection State: ${pc.iceConnectionState}`);
    };
    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection State: ${pc.connectionState}`);
    };
    pc.onsignalingstatechange = () => {
      console.log(`[WebRTC] Signaling State: ${pc.signalingState}`);
    };

    // Attach local stream tracks to WebRTC pipe
    const currentLocalStream = localStreamRef.current;
    if (currentLocalStream) {
      currentLocalStream.getTracks().forEach((track) => {
        pc.addTrack(track, currentLocalStream);
      });
    } else {
      addSystemMessage("Joining without active camera feed.");
    }

    // Handle receiving incoming track
    pc.ontrack = (event) => {
      console.log("[WebRTC] Track detected:", event.streams);
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      }
    };

    // Forward gathered ICE candidates to paired stranger
    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit("webrtc-signal", {
          to: peerSocketId,
          signal: { candidate: event.candidate }
        });
      }
    };

    // Immediately process any queued signaling signals that arrived before PeerConnection was fully constructed
    await processSignalQueue();

    // Initiator peer drafts offer SDP
    if (isInitiator) {
      try {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });
        await pc.setLocalDescription(offer);
        socketRef.current?.emit("webrtc-signal", {
          to: peerSocketId,
          signal: { offer }
        });
      } catch (err) {
        console.error("Failed to create SDP offer:", err);
      }
    }
  };

  const cleanPeerConnection = () => {
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch (e) {
        console.warn("Error closing PeerConnection", e);
      }
      pcRef.current = null;
    }
    setRemoteStream(null);
    partnerIdRef.current = null;
    setPartnerId(null);
    signalQueueRef.current = []; // Reset queue
  };

  // Interest list management
  const addInterest = (text: string) => {
    const formatted = text.trim().toLowerCase();
    if (!formatted) return;
    if (interests.includes(formatted)) {
      setInterestInput("");
      return;
    }
    setInterests((prev) => [...prev, formatted]);
    setInterestInput("");
    trackEvent("add_interest_tag", { tag: formatted });
  };

  const removeInterest = (item: string) => {
    setInterests((prev) => prev.filter((i) => i !== item));
    trackEvent("remove_interest_tag", { tag: item });
  };

  const handleInterestKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addInterest(interestInput);
    }
  };

  // Start search sequence
  const handleStartMatching = async () => {
    setMessages([]);
    setStrangerIsTyping(false);
    setCommonInterests([]);
    setRemoteStream(null);
    setAppState("searching");

    trackEvent("join_search", { mode, interests_count: interests.length, interests });

    addSystemMessage("Routing to connection pool...");

    // Lazy camera setup ahead of routing to maintain flow
    if (mode === "video") {
      addSystemMessage("Booting camera interface...");
      await requestLocalStream();
    }

    // Ping matching handshake to Express Socket.io server
    initSocketConnection();
    socketRef.current?.emit("start-search", {
      interests,
      mode
    });

    addSystemMessage("Searching for matching stranger based on interests...");
  };

  // Pause matching (cancel current search and remain in idle chat lobby)
  const handlePauseMatch = () => {
    socketRef.current?.emit("stop-search");
    setAppState("idle");
    cleanPeerConnection();
    addSystemMessage("Connection paused. You can edit your interests or click Resume/Connect to find a stranger.");
    trackEvent("match_paused", { mode });
  };

  // Skip partner/Find new pair
  const handleSkipMatch = () => {
    cleanPeerConnection();
    setMessages([]);
    setAppState("searching");
    addSystemMessage("Looking for a new stranger...");
    trackEvent("match_skipped", { mode, interests_count: interests.length });

    socketRef.current?.emit("start-search", {
      interests,
      mode
    });
  };

  // Cancel search and return to landing dashboards
  const handleStopMatch = () => {
    socketRef.current?.emit("stop-search");
    setAppState("idle");
    cleanPeerConnection();
    stopLocalMediaStream();
    setAppState("landing");
    trackEvent("match_stopped", { mode });
  };

  // Live client-side texting proxy
  const handleSendMessage = (text: string) => {
    if (!partnerIdRef.current) return;
    addMessage("you", text);
    socketRef.current?.emit("chat-message", { text });
    trackEvent("send_message", { 
      mode, 
      char_count: text.length, 
      word_count: text.split(/\s+/).filter(Boolean).length 
    });
  };

  const handleTypingStatus = (isTyping: boolean) => {
    if (!partnerIdRef.current) return;
    socketRef.current?.emit("typing", { isTyping });
  };

  // Inline Toggles for mic & video tracks
  const handleToggleCamera = () => {
    if (localStream) {
      const videoTracks = localStream.getVideoTracks();
      if (videoTracks.length > 0) {
        const nextState = !videoTracks[0].enabled;
        videoTracks[0].enabled = nextState;
        setCameraActive(nextState);
        trackEvent("toggle_camera", { enabled: nextState });
      }
    }
  };

  const handleToggleMic = () => {
    if (localStream) {
      const audioTracks = localStream.getAudioTracks();
      if (audioTracks.length > 0) {
        const nextState = !audioTracks[0].enabled;
        audioTracks[0].enabled = nextState;
        setMicActive(nextState);
        trackEvent("toggle_mic", { enabled: nextState });
      }
    }
  };

  return (
    <div className={`bg-slate-50 flex flex-col font-sans selection:bg-indigo-100 selection:text-indigo-900 ${
      appState === "landing" ? "min-h-screen min-h-[100dvh] overflow-y-auto" : "h-screen h-[100dvh] overflow-hidden"
    }`}>
      
      {/* Global Simple Navigation Bar */}
      <nav id="app-navigation" className="bg-white border-b border-slate-100 px-6 py-2 flex items-center justify-between sticky top-0 z-50 shadow-2xs h-[64px] lg:h-[110px] shrink-0">
        <div 
          onClick={handleStopMatch}
          className="flex items-center gap-3 cursor-pointer hover:opacity-90 active:scale-[0.99] transition-all select-none shrink-0"
          title="Return to home page"
        >
          <div className="h-9 w-9 bg-linear-to-tr from-sky-400 via-indigo-500 to-emerald-400 rounded-xl flex items-center justify-center text-white font-extrabold tracking-tighter text-lg shadow-md relative overflow-hidden">
            <span className="rotate-180 inline-block transform scale-110">Ω</span>
            <div className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-emerald-300 rounded-full animate-ping" />
            <div className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-emerald-400 rounded-full" />
          </div>
          <div className="hidden sm:block">
            <h1 className="text-sm font-extrabold tracking-tight text-slate-900 uppercase">Umegle</h1>
            <p className="text-[10px] text-slate-450 font-medium tracking-wide">Secure interest-based video chat</p>
          </div>
        </div>

        {/* Dynamic Horizontal Header Ad Placement - Desktop Only */}
        <div className="hidden lg:flex flex-grow items-center justify-center max-w-[728px] h-[90px] mx-4 relative overflow-hidden select-none shrink-0">
          <AdContainer idKey="c7c1f20ab8894b1ce40d9f3165e0672a" width={728} height={90} className="border-0 bg-transparent" />
        </div>

        {/* Global engagement & back action triggers */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2 bg-[#f4f7f6] border border-slate-200/50 px-3.5 py-1.5 rounded-full shadow-xs">
            <Activity className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
            <span className="text-xs font-mono font-semibold text-slate-700">
              {onlineCount ? onlineCount : "..."} Strangers
            </span>
          </div>
        </div>
      </nav>

      {/* Dynamic Sub-Header Ad for Mobile & Tablet */}
      <div className="lg:hidden w-full bg-slate-50 border-b border-slate-100 flex items-center justify-center h-[50px] sm:h-[60px] shrink-0 overflow-hidden select-none">
        <div className="flex items-center justify-center w-full">
          {/* Tablet/Medium Screen: 468x60 */}
          <div className="hidden sm:flex">
            <AdContainer idKey="428201e65fcb073cf1d2a6d187355241" width={468} height={60} />
          </div>
          {/* Mobile/Small Screen: 320x50 */}
          <div className="sm:hidden flex">
            <AdContainer idKey="d97fe668211722603fa724cc0c714e5e" width={320} height={50} />
          </div>
        </div>
      </div>

      {/* Main Container viewport */}
      <main className={`flex-grow flex-1 flex flex-col ${
        appState === "landing" ? "min-h-[500px]" : "min-h-0 overflow-hidden"
      }`}>
        <AnimatePresence mode="wait">          {appState === "landing" ? (
            <motion.div
              id="landing-dashboard"
              key="landing"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="flex-grow flex-1 w-full max-w-[1300px] mx-auto flex flex-row items-center justify-center py-8 px-4 gap-6"
            >
              {/* Left Skyscraper banner */}
              <div className="hidden xl:flex fixed left-0 top-[110px] flex-col items-center justify-center w-[160px] h-[600px] shrink-0 border border-l-0 border-slate-200 bg-white shadow-xs text-center select-none overflow-hidden z-40">
                <AdContainer idKey="e8619ab246117925511ef3ee3678d803" width={160} height={600} />
              </div>

              {/* Center Dashboard */}
              <div className="flex-grow max-w-4xl grid md:grid-cols-5 gap-6">
                
                {/* Left Columns - Welcome and Preferences configs */}
                <div className="md:col-span-3 space-y-6">
                  <div className="space-y-3">
                    <div className="inline-flex items-center gap-1.5 bg-indigo-50 border border-indigo-100 rounded-full px-3 py-1 text-xs text-indigo-700 font-semibold">
                      <Sparkles className="w-3.5 h-3.5" /> True Anonymous Connections
                    </div>
                    <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 leading-[1.12]">
                      Talk to strangers, <span className="text-linear bg-linear-to-r from-indigo-600 to-sky-500 bg-clip-text text-transparent">completely free.</span>
                    </h2>
                    <p className="text-sm text-slate-500 leading-relaxed max-w-lg">
                      Umegle pairs you instantly with peer companions worldwide. Filter matches by adding custom tag keywords to search for shared interests.
                    </p>
                  </div>

                  {/* Comma interests tag collector */}
                  <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block">Shared Interests (Optional)</label>
                      <p className="text-[11px] text-slate-450 leading-relaxed">Type interest categories and press <kbd className="font-semibold bg-slate-50 px-1 py-0.5 rounded border border-slate-200">Enter</kbd> or use comma separators.</p>
                    </div>

                    <div className="flex flex-wrap gap-1.5 min-h-[44px] p-2 bg-slate-50 rounded-xl border border-slate-200/60 focus-within:ring-2 focus-within:ring-indigo-600/20 focus-within:border-indigo-600 transition-all">
                      {interests.map((tag) => (
                        <span key={tag} className="inline-flex items-center gap-1 bg-indigo-600 text-white pl-2.5 pr-1.5 py-1 rounded-lg text-xs font-semibold shadow-2xs">
                          {tag}
                          <button onClick={() => removeInterest(tag)} className="p-0.5 text-indigo-300 hover:text-white hover:bg-indigo-500 rounded-md transition-colors">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                      <input
                        id="input-interests-tag"
                        type="text"
                        placeholder={interests.length ? "Add more..." : "e.g., music, coding, gaming..."}
                        value={interestInput}
                        onChange={(e) => setInterestInput(e.target.value)}
                        onKeyDown={handleInterestKeyDown}
                        className="flex-1 bg-transparent border-0 outline-hidden min-w-[120px] text-xs font-medium text-slate-800"
                      />
                    </div>

                    {/* Pre-seeded popular suggestions */}
                    <div className="space-y-2">
                      <span className="text-[10px] font-bold text-slate-450 uppercase tracking-wider block">Popular Categories:</span>
                      <div className="flex flex-wrap gap-1.5">
                        {POPULAR_SUGGESTIONS.map((item) => (
                          <button
                            key={item}
                            onClick={() => addInterest(item)}
                            disabled={interests.includes(item)}
                            className="bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-40 disabled:hover:bg-white border border-slate-200 px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
                          >
                            + {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Columns - Mode Selection card and Go Button */}
                <div className="md:col-span-2 flex flex-col justify-between space-y-4">
                  <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm flex-1 flex flex-col justify-between space-y-6">
                    <div className="space-y-3">
                      <span className="text-xs font-bold text-slate-700 uppercase tracking-widest block">Choose Matching Mode</span>
                      
                      <div className="space-y-3">
                        {/* Option 1: Text */}
                        <div 
                          id="mode-option-text"
                          onClick={() => setMode("text")}
                          className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex items-start gap-3.5 select-none ${
                            mode === "text" 
                              ? "border-indigo-600 bg-indigo-50/20" 
                              : "border-slate-100 hover:border-slate-200 bg-slate-50/50"
                          }`}
                        >
                          <div className={`p-2.5 rounded-lg shrink-0 ${mode === "text" ? "bg-indigo-600 text-white" : "bg-white text-slate-500 border border-slate-200"}`}>
                            <MessageSquare className="w-5 h-5" />
                          </div>
                          <div className="space-y-0.5">
                            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Chat Text Only</h4>
                            <p className="text-[11px] text-slate-500 leading-normal">Fast, anonymous texting matches. Optimized for tags and standard speed chats.</p>
                          </div>
                        </div>

                        {/* Option 2: Video */}
                        <div 
                          id="mode-option-video"
                          onClick={() => setMode("video")}
                          className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex items-start gap-3.5 select-none ${
                            mode === "video" 
                              ? "border-indigo-600 bg-indigo-50/20" 
                              : "border-slate-100 hover:border-slate-200 bg-slate-50/50"
                          }`}
                        >
                          <div className={`p-2.5 rounded-lg shrink-0 ${mode === "video" ? "bg-indigo-600 text-white" : "bg-white text-slate-500 border border-slate-200"}`}>
                            <Video className="w-5 h-5" />
                          </div>
                          <div className="space-y-0.5">
                            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Webcam Video & Voice</h4>
                            <p className="text-[11px] text-slate-500 leading-normal">Enable webcam audio & video dynamically with high quality WebRTC tunnels.</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Terms & Privacy Agreement checkbox required for onboarding */}
                    <div id="terms-agreement-row" className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/60 space-y-3 shadow-3xs select-none text-left">
                      <div className="flex items-start gap-2.5">
                        <input
                          id="checkbox-terms"
                          type="checkbox"
                          checked={agreedToTerms}
                          onChange={(e) => setAgreedToTerms(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 transition-all cursor-pointer"
                        />
                        <label htmlFor="checkbox-terms" className="text-xs text-slate-600 leading-normal font-semibold cursor-pointer">
                          I confirm that I am 18+ and agree to the{" "}
                          <button
                            type="button"
                            onClick={() => {
                              setShowTermsDetail(!showTermsDetail);
                              setShowPrivacyDetail(false);
                            }}
                            className="text-indigo-600 hover:underline font-extrabold bg-transparent border-0 cursor-pointer p-0 inline-block focus:outline-hidden"
                          >
                            Terms of Use
                          </button>
                          {" "}and{" "}
                          <button
                            type="button"
                            onClick={() => {
                              setShowPrivacyDetail(!showPrivacyDetail);
                              setShowTermsDetail(false);
                            }}
                            className="text-indigo-600 hover:underline font-extrabold bg-transparent border-0 cursor-pointer p-0 inline-block focus:outline-hidden"
                          >
                            Privacy Policy
                          </button>
                          .
                        </label>
                      </div>

                      {/* Expandable Info Cards */}
                      <AnimatePresence mode="wait">
                        {showTermsDetail && (
                          <motion.div
                            key="terms-highlights"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="text-[11px] text-slate-500 leading-relaxed bg-white border border-slate-100 rounded-lg p-3 space-y-1.5 shadow-2xs overflow-hidden"
                          >
                            <div className="font-bold text-slate-850 text-slate-800">Terms of Use Highlights:</div>
                            <ul className="list-disc list-inside space-y-1 pl-1">
                              <li>You must be at least 18 years old to join or use this chat applet.</li>
                              <li>No sexually explicit content, racial slurs, harassment, or offensive behaviors.</li>
                              <li>Protect your own identity; avoid sharing sensitive credentials or contact details.</li>
                            </ul>
                          </motion.div>
                        )}

                        {showPrivacyDetail && (
                          <motion.div
                            key="privacy-highlights"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="text-[11px] text-slate-500 leading-relaxed bg-white border border-slate-100 rounded-lg p-3 space-y-1.5 shadow-2xs overflow-hidden"
                          >
                            <div className="font-bold text-slate-850 text-slate-800">Privacy Policy Highlights:</div>
                            <ul className="list-disc list-inside space-y-1 pl-1">
                              <li>Connections utilize highly secure peer-to-peer (P2P) signaling pathways.</li>
                              <li>Text messages are entirely volatile and immediately deleted upon lobby exit.</li>
                              <li>We do not record, document, log, store, or sell any content streams.</li>
                            </ul>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Massive matching start trigger button */}
                    <button
                      id="btn-start-matching"
                      onClick={handleStartMatching}
                      disabled={!agreedToTerms}
                      className={`w-full h-14 text-white font-extrabold tracking-wide uppercase rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer ${
                        agreedToTerms
                          ? "bg-linear-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-805 hover:shadow-lg"
                          : "bg-slate-300 text-slate-400 cursor-not-allowed shadow-none border border-slate-200"
                      }`}
                    >
                      <span>Start Chatting</span>
                      <Sparkles className="w-4 h-4 text-sky-300" />
                    </button>
                  </div>

                  {/* Safety & Encryption warning card */}
                  <div className="bg-[#f0f9ff]/80 border border-sky-100 rounded-xl p-4 flex gap-3">
                    <ShieldCheck className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h5 className="text-xs font-bold text-sky-900 tracking-wide">P2P Encrypted Streams</h5>
                      <p className="text-[10px] text-sky-700 leading-relaxed">
                        Match connections exchange data peer-to-peer. Local computer streams are not cached or stored on centralized databases. Stay safe!
                      </p>
                    </div>
                  </div>

                  {/* Dynamic Adsterra Right Column Rectangular Ad Banner */}
                  <div className="flex flex-col items-center gap-1.5 py-1 text-center select-none shadow-3xs rounded-xl bg-white border border-slate-100 p-2">
                    <span className="text-[9px] font-extrabold text-slate-400 tracking-widest uppercase">Sponsored</span>
                    <AdContainer idKey="e3b922214b1e162ec763d9f9c81590e1" width={300} height={250} className="rounded-xl border border-slate-100 bg-white shadow-2xs" />
                  </div>
                </div>

              </div>

              {/* Right Skyscraper banner */}
              <div className="hidden xl:flex fixed right-0 top-[110px] flex-col items-center justify-center w-[160px] h-[600px] shrink-0 border border-r-0 border-slate-200 bg-white shadow-xs text-center select-none overflow-hidden z-40">
                <AdContainer idKey="e8619ab246117925511ef3ee3678d803" width={160} height={600} />
              </div>
            </motion.div>
          ) : (
            // Active Messaging Sandbox Stage with flanking Skyscraper Ads
            <div className={`flex-grow flex-1 flex flex-row w-full max-w-[1720px] mx-auto h-full min-h-0 overflow-hidden ${
              mode === "video" ? "bg-slate-900" : "bg-slate-50"
            }`}>

              {/* Left Chat Ad Column */}
              <div className={`hidden ${mode === "video" ? "2xl:flex" : "xl:flex"} flex-col items-center justify-start gap-2 w-[160px] h-full shrink-0 border-r py-3 select-none ${
                mode === "video" 
                  ? "bg-slate-950 border-slate-800 text-slate-400" 
                  : "bg-white border-slate-100 text-slate-600"
              }`}>
                <span className="text-[9px] font-extrabold opacity-60 tracking-widest uppercase">Sponsored</span>
                <div className="flex-grow flex items-center justify-center overflow-hidden w-full">
                  <AdContainer idKey="e8619ab246117925511ef3ee3678d803" width={160} height={600} />
                </div>
              </div>

              {/* Central Messaging Sandbox Stage */}
              <motion.div
                id="active-sandbox-stage"
                key="sandbox"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className={mode === "text" ? "flex-grow flex-1 h-full w-full flex flex-col outline-hidden bg-slate-50" : "flex-grow flex-1 h-full w-full grid md:grid-cols-2 outline-hidden bg-slate-900"}
              >
                {/* Media pane (left column: custom video feed, only shown in video mode!) */}
                {mode === "video" && (
                  <div className="h-1/2 md:h-full min-h-0 overflow-hidden flex flex-col">
                    <VideoPlayer
                      localStream={localStream}
                      remoteStream={remoteStream}
                      isSearching={appState === "searching"}
                      isPaired={appState === "paired"}
                      cameraActive={cameraActive}
                      micActive={micActive}
                      onToggleCamera={handleToggleCamera}
                      onToggleMic={handleToggleMic}
                      mode={mode}
                    />
                  </div>
                )}

                {/* Chat pane (right column or full width depending on mode) */}
                <div className={mode === "text" ? "flex-grow flex-1 flex flex-col h-full w-full bg-slate-50" : "h-1/2 md:h-full border-t md:border-t-0 border-slate-250/30"}>
                  <ChatPanel
                    messages={messages}
                    isSearching={appState === "searching"}
                    isPaired={appState === "paired"}
                    commonInterests={commonInterests}
                    strangerIsTyping={strangerIsTyping}
                    onSendMessage={handleSendMessage}
                    onSkip={handleSkipMatch}
                    onStop={handleStopMatch}
                    onTyping={handleTypingStatus}
                    interests={interests}
                    onAddInterest={addInterest}
                    onRemoveInterest={removeInterest}
                    autoConnect={autoConnect}
                    onToggleAutoConnect={() => setAutoConnect(prev => !prev)}
                    onPause={handlePauseMatch}
                  />
                </div>
              </motion.div>

              {/* Right Chat Ad Column */}
              <div className={`hidden ${mode === "video" ? "2xl:flex" : "xl:flex"} flex-col items-center justify-start gap-2 w-[160px] h-full shrink-0 border-l py-3 select-none ${
                mode === "video" 
                  ? "bg-slate-950 border-slate-800 text-slate-400" 
                  : "bg-white border-slate-100 text-slate-600"
              }`}>
                <span className="text-[9px] font-extrabold opacity-60 tracking-widest uppercase">Sponsored</span>
                <div className="flex-grow flex items-center justify-center overflow-hidden w-full">
                  <AdContainer idKey="e8619ab246117925511ef3ee3678d803" width={160} height={600} />
                </div>
              </div>

            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
