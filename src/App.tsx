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
  const [isInsideIframe, setIsInsideIframe] = useState(false);

  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        const framed = window.self !== window.top;
        setIsInsideIframe(framed);
      }
    } catch (e) {
      if (typeof window !== "undefined" && window.location.ancestorOrigins) {
        const ancestors = Array.from(window.location.ancestorOrigins);
        const containsStudio = ancestors.some(
          (o) => o.includes("ai.studio") || o.includes("google.com") || o.includes("aistudio")
        );
        setIsInsideIframe(containsStudio);
      } else {
        setIsInsideIframe(false);
      }
    }
  }, []);

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
  const [remoteStreamVersion, setRemoteStreamVersion] = useState<number>(0);
  const [cameraActive, setCameraActive] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [isStreamLoading, setIsStreamLoading] = useState(false);
  const [webrtcStatus, setWebrtcStatus] = useState<string>("idle");
  const [remoteVideoFrame, setRemoteVideoFrame] = useState<string | null>(null);

  // References
  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const modeRef = useRef<"text" | "video">(mode);
  const partnerIdRef = useRef<string | null>(partnerId);
  const signalProcessingQueueRef = useRef<{ signal: any; from: string }[]>([]);
  const isProcessingQueueRef = useRef<boolean>(false);
  const pendingRemoteCandidatesRef = useRef<any[]>([]);
  const isInitiatorRef = useRef<boolean>(false);

  // Sync refs to avoid stale closures in socket events
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const autoConnectRef = useRef<boolean>(autoConnect);
  const appStateRef = useRef<AppState>(appState);
  const agreedToTermsRef = useRef<boolean>(agreedToTerms);

  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  useEffect(() => {
    agreedToTermsRef.current = agreedToTerms;
  }, [agreedToTerms]);

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
        // Reduced noise: no system message sent when widening search fallback
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [appState, interests]);

  // Seamless Custom Socket-based Media Relaying & Fallback Engine
  useEffect(() => {
    let videoIntervalId: any = null;
    let audioRecorder: MediaRecorder | null = null;

    const currentPartner = partnerId;
    const socket = socketRef.current;
    
    // We only stream if paired, in video mode, and socket is active
    if (appState !== "paired" || mode !== "video" || !currentPartner || !socket) {
      return;
    }

    console.log("[MediaRelay] Launching smart media socket relay fallback streams...");

    // 1. Video Frame capturing (every ~85ms -> ~11 fps, highly fluid yet network-light!)
    if (cameraActive && localStream) {
      const offscreenCanvas = document.createElement("canvas");
      offscreenCanvas.width = 300;
      offscreenCanvas.height = 220;
      const ctx = offscreenCanvas.getContext("2d");

      videoIntervalId = setInterval(() => {
        const localVideoEl = document.getElementById("local-video") as HTMLVideoElement;
        if (localVideoEl && !localVideoEl.paused && !localVideoEl.ended && ctx) {
          try {
            ctx.drawImage(localVideoEl, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
            const base64Frame = offscreenCanvas.toDataURL("image/jpeg", 0.4); // highly compressed
            socket.emit("webrtc-signal", {
              to: currentPartner,
              signal: { mediaFrame: base64Frame }
            });
          } catch (e) {
            console.warn("[MediaRelay] Error rendering local video frame:", e);
          }
        }
      }, 85);
    }

    // 2. Audio chunks capturing/encoding (running in 250ms chunks)
    if (micActive && localStream) {
      const audioTracks = localStream.getAudioTracks();
      if (audioTracks.length > 0) {
        try {
          const recordStream = new MediaStream(audioTracks);
          let mimeOption = "";
          try {
            if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
              mimeOption = "audio/webm;codecs=opus";
            } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
              mimeOption = "audio/mp4";
            } else if (MediaRecorder.isTypeSupported("audio/aac")) {
              mimeOption = "audio/aac";
            }
          } catch (e) {
            // isTypeSupported fallback
          }

          const recorder = new MediaRecorder(
            recordStream,
            mimeOption ? { mimeType: mimeOption } : undefined
          );

          recorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
              const reader = new FileReader();
              reader.onloadend = () => {
                const base64Audio = reader.result as string;
                if (socket && partnerIdRef.current === currentPartner) {
                  socket.emit("webrtc-signal", {
                    to: currentPartner,
                    signal: { mediaAudioChunk: base64Audio }
                  });
                }
              };
              reader.readAsDataURL(event.data);
            }
          };

          audioRecorder = recorder;
          recorder.start(250); // Emit audio slices every 250ms
        } catch (recorderErr) {
          console.error("[MediaRelay] Failed to bootstrap custom audio recorder fallback:", recorderErr);
        }
      }
    }

    return () => {
      console.log("[MediaRelay] Cleared local media socket fallbacks.");
      if (videoIntervalId) {
        clearInterval(videoIntervalId);
      }
      if (audioRecorder && audioRecorder.state !== "inactive") {
        try {
          audioRecorder.stop();
        } catch (stopErr) {
          // ignore
        }
      }
    };
  }, [appState, partnerId, mode, cameraActive, micActive, localStream]);

  // Process queued WebRTC signaling messages safely and sequentially (FIFO) to prevent concurrent state collisions
  const processSequentialQueue = async () => {
    if (isProcessingQueueRef.current) return;
    isProcessingQueueRef.current = true;

    try {
      while (signalProcessingQueueRef.current.length > 0) {
        const pc = pcRef.current;
        if (!pc) {
          // Keep signals in the FIFO queue until RTCPeerConnection settles
          break;
        }

        const item = signalProcessingQueueRef.current.shift();
        if (!item) continue;

        const { signal, from } = item;

        try {
          if (signal.offer) {
            console.log("[SIGNALING] Processing offer from:", from);
            let activePc = pcRef.current;
            // If the responder's PeerConnection is failed, disconnected, or closed, we recreate it before applying
            if (!activePc || activePc.connectionState === "failed" || activePc.connectionState === "disconnected" || activePc.connectionState === "closed") {
              console.log("[WEBRTC] Receiver's PeerConnection is stale/failed. Re-instantiating responder connection before applying offer...");
              await initiateWebRTCPeer(from, false);
              activePc = pcRef.current;
            }
            if (activePc) {
              console.log("[SIGNALING] Calling setRemoteDescription with remote offer");
              try {
                await activePc.setRemoteDescription(signal.offer);
                console.log("[SIGNALING] setRemoteDescription (offer) succeeded");
              } catch (err) {
                console.error("[SIGNALING] setRemoteDescription (offer) failed:", err);
                throw err;
              }

              console.log("[SIGNALING] Calling createAnswer");
              let answer;
              try {
                answer = await activePc.createAnswer();
                console.log("[SIGNALING] createAnswer succeeded:", answer);
              } catch (err) {
                console.error("[SIGNALING] createAnswer failed:", err);
                throw err;
              }

              console.log("[SIGNALING] Calling setLocalDescription with generated answer");
              try {
                await activePc.setLocalDescription(answer);
                console.log("[SIGNALING] setLocalDescription (answer) succeeded");
              } catch (err) {
                console.error("[SIGNALING] setLocalDescription (answer) failed:", err);
                throw err;
              }

              socketRef.current?.emit("webrtc-signal", {
                to: from,
                signal: { answer }
              });

              // Process any stored candidates that were received before remote description was set
              if (pendingRemoteCandidatesRef.current.length > 0) {
                console.log("[ICE] Remote description set (offer). Loading stored candidates count:", pendingRemoteCandidatesRef.current.length);
                for (const cand of pendingRemoteCandidatesRef.current) {
                  const storedCandType = cand.candidate && cand.candidate.includes("typ")
                    ? (cand.candidate.match(/typ\s+(\w+)/)?.[1] || "unknown")
                    : "unknown";
                  try {
                    if (storedCandType === "relay") {
                      console.log(`%c[TURN] [ICE] relay candidate received (stored) from queue`, "color: #9333ea; font-style: italic;");
                      console.log(`%c[TURN] [ICE] Adding local/remote RELAY candidate (from stored queue)`, "color: #a855f7;");
                    }
                    console.log(`[ICE] Calling addIceCandidate for stored remote candidate | type: ${storedCandType} | candidate: "${cand.candidate}"`);
                    await activePc.addIceCandidate(new RTCIceCandidate(cand));
                    if (storedCandType === "relay") {
                      console.log(`%c[TURN] [ICE] relay candidate added (from stored queue) successfully!`, "color: #10b981; font-weight: bold;");
                    } else {
                      console.log(`[ICE] addIceCandidate (stored candidate) succeeded for type "${storedCandType}"`);
                    }
                  } catch (candidateErr) {
                    console.error(`[ICE] Error calling addIceCandidate for stored candidate of type "${storedCandType}":`, candidateErr);
                  }
                }
                pendingRemoteCandidatesRef.current = [];
              }
            }
          } else if (signal.answer) {
            console.log("[SIGNALING] Processing answer from:", from);
            if (pc) {
              console.log("[SIGNALING] Calling setRemoteDescription with remote answer");
              try {
                await pc.setRemoteDescription(signal.answer);
                console.log("[SIGNALING] setRemoteDescription (answer) succeeded");
              } catch (err) {
                console.error("[SIGNALING] setRemoteDescription (answer) failed:", err);
                throw err;
              }

              // Process any stored candidates that were received before remote description was set
              if (pendingRemoteCandidatesRef.current.length > 0) {
                console.log("[ICE] Remote description set (answer). Loading stored candidates count:", pendingRemoteCandidatesRef.current.length);
                for (const cand of pendingRemoteCandidatesRef.current) {
                  const storedCandType = cand.candidate && cand.candidate.includes("typ")
                    ? (cand.candidate.match(/typ\s+(\w+)/)?.[1] || "unknown")
                    : "unknown";
                  try {
                    if (storedCandType === "relay") {
                      console.log(`%c[TURN] [ICE] relay candidate received (stored) from queue`, "color: #9333ea; font-style: italic;");
                      console.log(`%c[TURN] [ICE] Adding local/remote RELAY candidate (from stored queue)`, "color: #a855f7;");
                    }
                    console.log(`[ICE] Calling addIceCandidate for stored remote candidate | type: ${storedCandType} | candidate: "${cand.candidate}"`);
                    await pc.addIceCandidate(new RTCIceCandidate(cand));
                    if (storedCandType === "relay") {
                      console.log(`%c[TURN] [ICE] relay candidate added (from stored queue) successfully!`, "color: #10b981; font-weight: bold;");
                    } else {
                      console.log(`[ICE] addIceCandidate (stored candidate) succeeded for type "${storedCandType}"`);
                    }
                  } catch (candidateErr) {
                    console.error(`[ICE] Error calling addIceCandidate for stored candidate of type "${storedCandType}":`, candidateErr);
                  }
                }
                pendingRemoteCandidatesRef.current = [];
              }
            }
          } else if (signal.requestOffer) {
            console.log("[SIGNALING] Peer requested progressive SDP offer/renegotiate.");
            if (isInitiatorRef.current) {
              let activePc = pcRef.current;
              // If the initiator's PeerConnection is failed/stale, recreate it to provide a clean offer
              if (!activePc || activePc.connectionState === "failed" || activePc.connectionState === "disconnected" || activePc.connectionState === "closed") {
                console.log("[WEBRTC] Initiator's PeerConnection is failed/stale. Re-initiating peer connection first...");
                await initiateWebRTCPeer(from, true);
                activePc = pcRef.current;
              }
              if (activePc) {
                try {
                  console.log("[SIGNALING] Calling createOffer due to requestOffer petition");
                  const offer = await activePc.createOffer();
                  console.log("[SIGNALING] createOffer succeeded:", offer);
                  
                  console.log("[SIGNALING] Calling setLocalDescription with generated offer");
                  await activePc.setLocalDescription(offer);
                  console.log("[SIGNALING] setLocalDescription (offer) succeeded");

                  socketRef.current?.emit("webrtc-signal", {
                    to: from,
                    signal: { offer }
                  });
                } catch (err) {
                  console.error("[SIGNALING] Failed to generate/negotiate offer during requestOffer process:", err);
                }
              }
            }
          } else if (signal.candidate) {
            const candType = signal.candidate.candidate && signal.candidate.candidate.includes("typ")
              ? (signal.candidate.candidate.match(/typ\s+(\w+)/)?.[1] || "unknown")
              : "unknown";
            
            if (candType === "relay") {
              console.log(`%c[TURN] [ICE] relay candidate received from ${from}: ip=${signal.candidate.address || "unknown"} | port=${signal.candidate.port || "unknown"}`, "color: #f59e0b; font-weight: bold;");
            }

            if (pc.remoteDescription && pc.remoteDescription.type) {
              console.log(`[ICE] Attempting to add incoming ICE candidate from ${from} | type: ${candType} | ip: ${signal.candidate.address || "unknown"} | port: ${signal.candidate.port || "unknown"}`);
              try {
                if (candType === "relay") {
                  console.log(`%c[TURN] [ICE] Adding RELAY candidate dynamically`, "color: #d946ef;");
                }
                console.log(`[ICE] Calling addIceCandidate for type "${candType}" | candidate: "${signal.candidate.candidate}"`);
                await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
                if (candType === "relay") {
                  console.log(`%c[TURN] [ICE] relay candidate added successfully!`, "color: #10b981; font-weight: bold;");
                } else {
                  console.log(`[ICE] Successfully added remote ICE candidate (${candType})`);
                }
              } catch (candidateErr) {
                console.error(`[ICE] Error calling addIceCandidate dynamically for type "${candType}":`, candidateErr, "\nCandidate content:", signal.candidate);
              }
            } else {
              if (candType === "relay") {
                console.log(`%c[TURN] [ICE] RemoteDescription not yet set. Storing incoming RELAY candidate in pending queue`, "color: #3b82f6;");
              } else {
                console.log(`[ICE] RemoteDescription not yet set. Storing incoming "${candType}" ICE candidate in pending queue.`);
              }
              pendingRemoteCandidatesRef.current.push(signal.candidate);
            }
          }
        } catch (err) {
          console.error("[WebRTC Queue] Error processing signaling item:", err, "Signal object:", signal);
        }
      }
    } finally {
      isProcessingQueueRef.current = false;
    }
  };

  const enqueueSignal = (signal: any, from: string) => {
    console.log("[WebRTC Queue] Enqueuing signaling packet from:", from);
    signalProcessingQueueRef.current.push({ signal, from });
    processSequentialQueue();
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
      // Secure check: only set paired state if we are currently searching and have agreed to terms!
      if (appStateRef.current !== "searching") {
        console.warn("[Onboarding] Ignored pairing offer: client is not currently in a searching state.");
        return;
      }
      if (!agreedToTermsRef.current) {
        console.warn("[Onboarding] Ignored pairing offer: client has not consented to current terms.");
        return;
      }

      partnerIdRef.current = peerId; // STABILIZE REF SYNCHRONOUSLY!
      isInitiatorRef.current = initiator; // Save initiator value!
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

      addSystemMessage("stranger connected");

      // If user selected Video mode, instantly negotiate WebRTC peer stream
      if (modeRef.current === "video") {
        await initiateWebRTCPeer(peerId, initiator);
      }
    });

    // Handle instant incoming messages
    socket.on("chat-message", ({ text }: { text: string }) => {
      if (appStateRef.current !== "paired") return;
      addMessage("stranger", text);
    });

    // Handle typing status indications
    socket.on("typing", ({ isTyping }: { isTyping: boolean }) => {
      if (appStateRef.current !== "paired") return;
      setStrangerIsTyping(isTyping);
    });

    // WebRTC signaling relay callback
    socket.on("webrtc-signal", ({ from, signal }) => {
      if (appStateRef.current !== "paired") return;
      const currentPartner = partnerIdRef.current;
      if (from !== currentPartner) return;
      
      if (signal && signal.mediaFrame) {
        setRemoteVideoFrame(signal.mediaFrame);
      } else if (signal && signal.mediaAudioChunk) {
        try {
          const audio = new Audio(signal.mediaAudioChunk);
          audio.volume = 1.0;
          audio.play().catch((err) => {
            // Ignore minor benign playback alerts
            console.log("[AudioRelay] Direct play deferred:", err.message);
          });
        } catch (audioErr) {
          console.warn("[AudioRelay] Audio element builder failed:", audioErr);
        }
      } else {
        enqueueSignal(signal, from);
      }
    });

    // Handle sudden stranger disconnects or leaves
    socket.on("stranger-disconnected", () => {
      if (appStateRef.current !== "paired" && appStateRef.current !== "searching") return;
      addSystemMessage("Stranger has disconnected.");
      cleanPeerConnection();
      trackEvent("match_disconnected", { mode: modeRef.current });
      if (autoConnectRef.current && agreedToTermsRef.current) {
        setTimeout(() => {
          if (appStateRef.current === "searching" || appStateRef.current === "idle") {
            handleSkipMatch();
          }
        }, 1500);
      } else {
        setAppState("idle");
        addSystemMessage("Connection paused. Refine your interests or click Resume/Connect to start matching.");
      }
    });

    // Socket fallback status logs
    socket.on("disconnect", () => {
      if (appStateRef.current === "landing") return;
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
    let resolvedStream: MediaStream | null = null;
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
      resolvedStream = stream;
      return stream;
    } catch (err) {
      console.warn("High-quality media stream denied, attempting standard video+audio fallback...", err);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        setLocalStream(stream);
        setCameraActive(true);
        setMicActive(true);
        resolvedStream = stream;
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
          resolvedStream = stream;
          return stream;
        } catch (err2) {
          try {
            // Fallback 2: Audio-only if webcam is blocked or missing
            const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
            localStreamRef.current = stream;
            setLocalStream(stream);
            setCameraActive(false);
            setMicActive(true);
            resolvedStream = stream;
            return stream;
          } catch (err3) {
            console.error("All camera and microphone hardware tracks denied entirely.", err3);
            localStreamRef.current = null;
            setLocalStream(null);
            setCameraActive(false);
            setMicActive(false);
            resolvedStream = null;
            return null;
          }
        }
      }
    } finally {
      setIsStreamLoading(false);
      if (resolvedStream) {
        await syncLocalStreamWithPeerConnection(resolvedStream);
      }
    }
  };

  const syncLocalStreamWithPeerConnection = async (stream: MediaStream) => {
    const pc = pcRef.current;
    if (!pc) return;

    console.log("[WebRTC] Synchronizing newly acquired local stream tracks with existing PeerConnection...");
    let changed = false;
    const senders = pc.getSenders();

    for (const track of stream.getTracks()) {
      const alreadyAdded = senders.some((s) => s.track === track);
      if (!alreadyAdded) {
        console.log(`[WebRTC] Attaching track ${track.kind} of local stream to existing PeerConnection.`);
        try {
          pc.addTrack(track, stream);
          changed = true;
        } catch (addError) {
          console.warn("[WebRTC] Error adding track dynamically:", addError);
        }
      }
    }

    if (changed) {
      await renegotiatePeerConnection();
    }
  };

  const renegotiatePeerConnection = async () => {
    const pc = pcRef.current;
    if (!pc || !partnerIdRef.current) return;

    if (isInitiatorRef.current) {
      try {
        console.log("[WebRTC] Creating renegotiation SDP offer...");
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current?.emit("webrtc-signal", {
          to: partnerIdRef.current,
          signal: { offer }
        });
      } catch (err) {
        console.error("[WebRTC] Failed to create renegotiation offer:", err);
      }
    } else {
      console.log("[WebRTC] Requesting initiator to trigger renegotiation offer...");
      socketRef.current?.emit("webrtc-signal", {
        to: partnerIdRef.current,
        signal: { requestOffer: true }
      });
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
    signalProcessingQueueRef.current = [];
    isProcessingQueueRef.current = false;
    pendingRemoteCandidatesRef.current = [];

    // Configure STUN/TURN servers. Support dynamic production TURN configuration via environment variables
    const customIceServers: RTCIceServer[] = [
      // 1. Standard STUN Servers (highly reliable Google infrastructure)
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },

      // 2. High-performance Secure TURN (turns) on port 443 over TCP.
      // Acts as fall-back standard HTTPS, guaranteeing cellular/corporate firewall bypass.
      {
        urls: "turns:openrelay.metered.ca:443?transport=tcp",
        username: "openrelayproject",
        credential: "openrelayproject"
      },

      // 3. Fallback TURN (turn) on standard WebRTC UDP port 3478
      {
        urls: "turn:openrelay.metered.ca:3478?transport=udp",
        username: "openrelayproject",
        credential: "openrelayproject"
      }
    ];

    const envTurnUrl = (import.meta as any).env.VITE_TURN_URL;
    const envTurnUser = (import.meta as any).env.VITE_TURN_USERNAME;
    const envTurnCred = (import.meta as any).env.VITE_TURN_CREDENTIAL;

    if (envTurnUrl) {
      console.log("[WebRTC] Injecting custom high-authority TURN server configurations from system env:", envTurnUrl);
      const customSvr: RTCIceServer = {
        urls: envTurnUrl,
      };
      if (envTurnUser) customSvr.username = envTurnUser;
      if (envTurnCred) customSvr.credential = envTurnCred;
      
      // Place at the very top of iceServers array to prioritize it
      customIceServers.unshift(customSvr);
    } else {
      console.warn("[WebRTC] No dedicated VITE_TURN_URL configured. Falling back to public metered.ca open relay credentials.");
    }

    const pc = new RTCPeerConnection({
      iceServers: customIceServers,
      iceTransportPolicy: "relay"
    });

    pcRef.current = pc;

    // Helper to query RTCPeerConnection statistics and explicitly log the active selected candidate pair
    const logSelectedCandidatePair = async () => {
      try {
        const stats = await pc.getStats();
        stats.forEach((report) => {
          if (report.type === "candidate-pair" && (report.state === "succeeded" || report.nominated)) {
            const localCandidate = stats.get(report.localCandidateId);
            const remoteCandidate = stats.get(report.remoteCandidateId);
            if (localCandidate && remoteCandidate) {
              console.log(
                `%c[WEBRTC] Selected candidate pair active: ` +
                `Local=[type=${localCandidate.candidateType} ip=${localCandidate.ip || localCandidate.address || "unknown"} port=${localCandidate.port || "unknown"} protocol=${localCandidate.protocol || "unknown"}] <-> ` +
                `Remote=[type=${remoteCandidate.candidateType} ip=${remoteCandidate.ip || remoteCandidate.address || "unknown"} port=${remoteCandidate.port || "unknown"} protocol=${remoteCandidate.protocol || "unknown"}]`,
                "color: #10b981; font-weight: bold; font-family: monospace; font-size: 11px;"
              );
            }
          }
        });
      } catch (err) {
        console.warn("[WEBRTC] Failed to fetch selected candidate pair stats:", err);
      }
    };

    // Monitor WebRTC states
    pc.oniceconnectionstatechange = () => {
      console.log(`[ICE] ICE Connection State changed to: ${pc.iceConnectionState}`);
      setWebrtcStatus(pc.iceConnectionState);
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        logSelectedCandidatePair();
      }
      if (pc.iceConnectionState === "failed") {
        console.warn("[ICE] ICE Connection failed. Triggering ICE restart...");
        handleIceRestart(peerSocketId, isInitiator);
      }
    };
    pc.onconnectionstatechange = () => {
      console.log(`[WEBRTC] PeerConnection State changed to: ${pc.connectionState}`);
      setWebrtcStatus(pc.connectionState);
      if (pc.connectionState === "connected") {
        logSelectedCandidatePair();
      }
    };
    pc.onsignalingstatechange = () => {
      console.log(`[SIGNALING] Signaling State changed to: ${pc.signalingState}`);
    };
    pc.onicegatheringstatechange = () => {
      console.log(`[ICE] ICE Gathering State changed to: ${pc.iceGatheringState}`);
    };

    // Listen to ICE candidate gathering errors (e.g. TURN allocation / 701 errors)
    pc.onicecandidateerror = (event: any) => {
      console.error(
        `%c[TURN] [ICE] onicecandidateerror: errorCode=${event.errorCode} | ` +
        `errorText="${event.errorText}" | ` +
        `failingUrl="${event.url || "unknown"}"`,
        "color: #ff0055; font-weight: bold; font-family: monospace; font-size: 11px;"
      );
    };

    // Attach local stream tracks to WebRTC pipe
    const currentLocalStream = localStreamRef.current;
    if (currentLocalStream && currentLocalStream.getTracks().length > 0) {
      currentLocalStream.getTracks().forEach((track) => {
        pc.addTrack(track, currentLocalStream);
      });
    } else {
      // If we don't have local tracks, explicitly declare direction to receive audio and video.
      // This is necessary for Chrome and Safari to correctly negotiate receiving incoming streams 
      // when the local user's camera / microphone access is disabled or not yet resolved.
      try {
        pc.addTransceiver("audio", { direction: "recvonly" });
        pc.addTransceiver("video", { direction: "recvonly" });
      } catch (err) {
        console.warn("[WEBRTC] Failed to add recvonly transceivers:", err);
      }
      addSystemMessage("Joining without active camera feed.");
    }

    // Handle receiving incoming track with high-availability track merging
    pc.ontrack = (event) => {
      console.log(`[WEBRTC] ontrack callback triggered: Kind="${event.track.kind}" | ID="${event.track.id}" | StreamsLength=${event.streams?.length || 0}`);
      
      if (event.streams && event.streams[0]) {
        const inboundStream = event.streams[0];
        // Create a new MediaStream wrapper to force reference change in React state.
        // This guarantees that when a second track (e.g., video track after audio track) is added,
        // React immediately updates component bindings instead of short-circuiting on equal object referential checks.
        setRemoteStream(new MediaStream(inboundStream.getTracks()));
        setRemoteStreamVersion((v) => v + 1);

        // Bind listeners to trigger updates if the browser adds another track (e.g. video following audio) dynamically
        inboundStream.onaddtrack = (trackEvent) => {
          console.log(`[WEBRTC] Dynamic track added to active stranger stream: kind="${trackEvent.track.kind}"`);
          setRemoteStream(new MediaStream(inboundStream.getTracks()));
          setRemoteStreamVersion((v) => v + 1);
        };
        inboundStream.onremovetrack = () => {
          setRemoteStream(new MediaStream(inboundStream.getTracks()));
          setRemoteStreamVersion((v) => v + 1);
        };
      } else {
        // Fallback for custom clients that send raw tracks without stream containers
        setRemoteStream((prev) => {
          if (!prev) {
            const nextStream = new MediaStream([event.track]);
            setRemoteStreamVersion((v) => v + 1);
            return nextStream;
          } else {
            if (!prev.getTracks().some((t) => t.id === event.track.id)) {
              prev.addTrack(event.track);
            }
            const nextStream = new MediaStream(prev.getTracks());
            setRemoteStreamVersion((v) => v + 1);
            return nextStream;
          }
        });
      }
    };

    // Forward gathered ICE candidates to paired stranger
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // Robust regex to extract the candidate type (host, srflx, or relay)
        const candidateStr = event.candidate.candidate;
        const typeMatch = candidateStr.match(/typ\s+(\w+)/);
        const candidateType = typeMatch ? typeMatch[1] : "unknown";
        
        if (candidateType === "relay") {
          console.log(`%c[TURN] [ICE] relay candidate generated: type=${candidateType} | ip=${event.candidate.address || "unknown"} | port=${event.candidate.port || "unknown"} | sdp="${candidateStr}"`, "color: #10b981; font-weight: bold;");
        } else {
          console.log(`[ICE] onicecandidate gathered: type=${candidateType} | ip=${event.candidate.address || "unknown"} | port=${event.candidate.port || "unknown"} | sdp="${candidateStr}"`);
        }

        if (socketRef.current) {
          socketRef.current.emit("webrtc-signal", {
            to: peerSocketId,
            signal: { candidate: event.candidate }
          });
        }
      } else {
        console.log("[ICE] onicecandidate: ICE gathering completed (null candidate received).");
      }
    };

    // Immediately process any queued signaling signals that arrived before PeerConnection was fully constructed
    await processSequentialQueue();

    // Initiator peer drafts offer SDP
    if (isInitiator) {
      try {
        console.log("[SIGNALING] Initiator: Calling createOffer");
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });
        console.log("[SIGNALING] Initiator: createOffer succeeded:", offer);
        
        console.log("[SIGNALING] Initiator: Calling setLocalDescription");
        await pc.setLocalDescription(offer);
        console.log("[SIGNALING] Initiator: setLocalDescription success");

        socketRef.current?.emit("webrtc-signal", {
          to: peerSocketId,
          signal: { offer }
        });
      } catch (err) {
        console.error("[SIGNALING] Initiator: Failed to create/set local SDP offer:", err);
      }
    }
  };

  // ICE Restart helper on failure
  const handleIceRestart = async (peerSocketId: string, isInitiator: boolean) => {
    const pc = pcRef.current;
    if (!pc) return;
    if (isInitiator) {
      try {
        console.log("[WebRTC] Attempting ICE restart...");
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        socketRef.current?.emit("webrtc-signal", {
          to: peerSocketId,
          signal: { offer }
        });
        addSystemMessage("Re-routing connection path...");
      } catch (err) {
        console.error("Failed to execute ICE restart offer generation:", err);
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
    setRemoteVideoFrame(null);
    partnerIdRef.current = null;
    setPartnerId(null);
    signalProcessingQueueRef.current = []; // Reset queue
    isProcessingQueueRef.current = false;
    pendingRemoteCandidatesRef.current = [];
    setWebrtcStatus("idle");
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
    if (!agreedToTermsRef.current) {
      console.warn("[Consent Check] blocked start search - terms not accepted");
      return;
    }
    setMessages([]);
    setStrangerIsTyping(false);
    setCommonInterests([]);
    setRemoteStream(null);
    setAppState("searching");

    trackEvent("join_search", { mode, interests_count: interests.length, interests });

    if (interests && interests.length > 0) {
      addSystemMessage("please wait while we connect to a random stranger based on your interests");
    } else {
      addSystemMessage("please wait while we connect you to a random stranger");
    }

    // Lazy camera setup ahead of routing to maintain flow
    if (mode === "video") {
      await requestLocalStream();
    }

    // Ping matching handshake to Express Socket.io server
    initSocketConnection();
    socketRef.current?.emit("start-search", {
      interests,
      mode
    });
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
    if (!agreedToTermsRef.current) {
      console.warn("[Consent Check] blocked skip match - terms not accepted");
      return;
    }
    cleanPeerConnection();
    setMessages([]);
    setAppState("searching");
    if (interests && interests.length > 0) {
      addSystemMessage("please wait while we connect to a random stranger based on your interests");
    } else {
      addSystemMessage("please wait while we connect you to a random stranger");
    }
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
  const handleToggleCamera = async () => {
    if (localStream) {
      const videoTracks = localStream.getVideoTracks();
      if (videoTracks.length > 0) {
        const nextState = !videoTracks[0].enabled;
        videoTracks[0].enabled = nextState;
        setCameraActive(nextState);
        trackEvent("toggle_camera", { enabled: nextState });
      } else {
        await requestLocalStream();
      }
    } else {
      await requestLocalStream();
    }
  };

  const handleToggleMic = async () => {
    if (localStream) {
      const audioTracks = localStream.getAudioTracks();
      if (audioTracks.length > 0) {
        const nextState = !audioTracks[0].enabled;
        audioTracks[0].enabled = nextState;
        setMicActive(nextState);
        trackEvent("toggle_mic", { enabled: nextState });
      } else {
        await requestLocalStream();
      }
    } else {
      await requestLocalStream();
    }
  };

  const handleRetryWebRTC = async () => {
    if (partnerIdRef.current) {
      console.log("[WebRTC] Manually retrying WebRTC connection with partner:", partnerIdRef.current);
      addSystemMessage("Re-negotiating peer association tracks...");
      setWebrtcStatus("connecting");
      await initiateWebRTCPeer(partnerIdRef.current, isInitiatorRef.current);
      
      // If we are the responder, we must trigger the initiator to generate and send a new SDP offer
      if (!isInitiatorRef.current) {
        console.log("[WebRTC] Non-initiating responder triggered retry. Dispatched requestOffer to initiator.");
        socketRef.current?.emit("webrtc-signal", {
          to: partnerIdRef.current,
          signal: { requestOffer: true }
        });
      }
    } else {
      console.warn("[WebRTC] Cannot retry WebRTC transition, no active partner ID ref");
    }
  };

  return (
    <div className={`bg-slate-50 flex flex-col font-sans selection:bg-indigo-100 selection:text-indigo-900 ${
      appState === "landing" ? "min-h-screen min-h-[100dvh] overflow-y-auto" : "h-screen h-[100dvh] overflow-hidden"
    }`}>
      
      {/* Global Simple Navigation Bar */}
      <nav id="app-navigation" className="bg-white border-b border-slate-100 px-4 sm:px-6 py-1.5 flex items-center justify-between sticky top-0 z-50 shadow-2xs h-[56px] sm:h-[64px] lg:h-[76px] shrink-0">
        <a 
          href="/"
          onClick={(e) => {
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
              return; // Let browser process native multi-target modifier key clicks
            }
            e.preventDefault();
            handleStopMatch();
          }}
          className="flex items-center gap-3 cursor-pointer hover:opacity-90 active:scale-[0.99] transition-all select-none shrink-0 text-slate-900 hover:text-slate-900 decoration-none no-underline"
          title="Return to home page"
        >
          <div className="h-8 w-8 bg-linear-to-tr from-sky-400 via-indigo-500 to-emerald-400 rounded-lg flex items-center justify-center text-white font-extrabold tracking-tighter text-base shadow-sm relative overflow-hidden">
            <span className="rotate-180 inline-block transform scale-110">Ω</span>
            <div className="absolute top-0.5 right-0.5 w-1 h-1 bg-emerald-300 rounded-full animate-ping" />
            <div className="absolute top-0.5 right-0.5 w-1 h-1 bg-emerald-400 rounded-full" />
          </div>
          <div className="hidden sm:block">
            <h1 className="text-xs sm:text-sm font-extrabold tracking-tight text-slate-900 uppercase">Umegle</h1>
            <p className="text-[9px] sm:text-[10px] text-slate-400 font-medium tracking-wide">Secure interest-based video chat</p>
          </div>
        </a>

        {/* Dynamic Horizontal Header Ad Placement - Desktop Only */}
        <div className="hidden lg:flex flex-grow items-center justify-center max-w-[640px] h-[60px] mx-4 relative overflow-hidden select-none shrink-0">
          <div className="scale-[0.7] transform origin-center">
            <AdContainer idKey="c7c1f20ab8894b1ce40d9f3165e0672a" width={728} height={90} className="border-0 bg-transparent" />
          </div>
        </div>

        {/* Global engagement & back action triggers */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2 bg-[#f4f7f6] border border-slate-200/50 px-2.5 py-1 rounded-full shadow-xs">
            <Activity className="w-3 h-3 text-emerald-500 animate-pulse" />
            <span className="text-[11px] font-mono font-semibold text-slate-700">
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
        appState === "landing" ? "min-h-[500px]" : "h-0 min-h-0 overflow-hidden"
      }`}>
        <AnimatePresence mode="wait">          {appState === "landing" ? (
            <motion.div
              id="landing-dashboard"
              key="landing"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="flex-grow flex-1 w-full max-w-[1300px] mx-auto flex flex-row items-center justify-center py-4 sm:py-5 px-4 gap-4"
            >
              {/* Left Skyscraper banner */}
              <div className="hidden xl:flex fixed left-5 top-[90px] flex-col items-center justify-center w-[160px] h-[600px] shrink-0 border border-slate-200 rounded-2xl bg-white shadow-md text-center select-none overflow-hidden z-40">
                <AdContainer idKey="e8619ab246117925511ef3ee3678d803" width={160} height={600} />
              </div>

              {/* Center Dashboard */}
              <div className="flex-grow max-w-2xl mx-auto space-y-4 w-full">
                
                {/* Hero / Welcome Section */}
                <div className="space-y-1.5 text-center sm:text-left flex flex-col sm:items-start">
                  <div className="inline-flex items-center gap-1.5 bg-indigo-50 border border-indigo-100 rounded-full px-2.5 py-0.5 text-[11px] text-indigo-700 font-semibold self-center sm:self-start">
                    <Sparkles className="w-3 h-3" /> True Anonymous Connections
                  </div>
                  <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 leading-tight">
                    Talk to strangers, <span className="text-linear bg-linear-to-r from-indigo-600 to-sky-500 bg-clip-text text-transparent">completely free.</span>
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-500 leading-normal max-w-xl">
                    Umegle pairs you instantly with peer companions worldwide. Filter matches by adding custom tag keywords to search for shared interests.
                  </p>
                </div>

                {/* Merged Preferences & Mode Selection Card (Targeted Widget) */}
                <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-100 shadow-sm space-y-4">
                  
                  {/* Part 1: Choose Matching Mode */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Choose Matching Mode</span>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {/* Option 1: Text */}
                      <div 
                        id="mode-option-text"
                        onClick={() => setMode("text")}
                        className={`p-2.5 rounded-lg border-2 cursor-pointer transition-all flex items-start gap-2.5 select-none ${
                          mode === "text" 
                            ? "border-indigo-600 bg-indigo-50/15" 
                            : "border-slate-100 hover:border-slate-200 bg-slate-50/30"
                        }`}
                      >
                        <div className={`p-1.5 rounded-md shrink-0 ${mode === "text" ? "bg-indigo-600 text-white" : "bg-white text-slate-500 border border-slate-200"}`}>
                          <MessageSquare className="w-4 h-4" />
                        </div>
                        <div className="space-y-0.5">
                          <h4 className="text-xs font-bold text-slate-800 tracking-tight">Chat Text Only</h4>
                          <p className="text-[10px] text-slate-500 leading-tight">Fast, anonymous texting matches with tags.</p>
                        </div>
                      </div>

                      {/* Option 2: Video */}
                      <div 
                        id="mode-option-video"
                        onClick={() => setMode("video")}
                        className={`p-2.5 rounded-lg border-2 cursor-pointer transition-all flex flex-col gap-2 select-none ${
                          mode === "video" 
                            ? "border-indigo-600 bg-indigo-50/15" 
                            : "border-slate-100 hover:border-slate-200 bg-slate-50/30"
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          <div className={`p-1.5 rounded-md shrink-0 ${mode === "video" ? "bg-indigo-600 text-white" : "bg-white text-slate-500 border border-slate-200"}`}>
                            <Video className="w-4 h-4" />
                          </div>
                          <div className="space-y-0.5">
                            <h4 className="text-xs font-bold text-slate-800 tracking-tight">Webcam Video & Voice</h4>
                            <p className="text-[10px] text-slate-500 leading-tight">Enable video dynamically with WebRTC tunnels.</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 my-2.5" />

                  {/* Part 2: Shared Interests tag collector */}
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Shared Interests (Optional)</label>
                      <span className="text-[9px] text-slate-400">Press Enter or use comma separators</span>
                    </div>

                    <div className="flex flex-wrap gap-1 min-h-[38px] p-1.5 bg-slate-50 rounded-lg border border-slate-200/60 focus-within:ring-2 focus-within:ring-indigo-600/20 focus-within:border-indigo-600 transition-all">
                      {interests.map((tag) => (
                        <span key={tag} className="inline-flex items-center gap-1 bg-indigo-600 text-white pl-2 pr-1 py-0.5 rounded-md text-[11px] font-semibold shadow-2xs">
                          {tag}
                          <button onClick={() => removeInterest(tag)} className="p-0.5 text-indigo-300 hover:text-white hover:bg-indigo-500 rounded-xs transition-colors">
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </span>
                      ))}
                      <input
                        id="input-interests-tag"
                        type="text"
                        placeholder={interests.length ? "Add..." : "e.g., music, coding, games"}
                        value={interestInput}
                        onChange={(e) => setInterestInput(e.target.value)}
                        onKeyDown={handleInterestKeyDown}
                        className="flex-1 bg-transparent border-0 outline-hidden min-w-[100px] text-[11px] font-medium text-slate-800"
                      />
                    </div>
                  </div>

                  <div className="border-t border-slate-100 my-2.5" />

                  {/* Part 3: Terms Agreement & Onboarding Start Action Button */}
                  <div className="space-y-2.5">
                    {/* Terms & Privacy Agreement checkbox required for onboarding */}
                    <div id="terms-agreement-row" className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/60 space-y-2 shadow-3xs select-none text-left">
                      <div className="flex items-start gap-2">
                        <input
                          id="checkbox-terms"
                          type="checkbox"
                          checked={agreedToTerms}
                          onChange={(e) => setAgreedToTerms(e.target.checked)}
                          className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 transition-all cursor-pointer"
                        />
                        <label htmlFor="checkbox-terms" className="text-[11px] text-slate-650 leading-snug font-medium cursor-pointer">
                          I am 18+ and agree to the{" "}
                          <button
                            type="button"
                            onClick={() => {
                              setShowTermsDetail(!showTermsDetail);
                              setShowPrivacyDetail(false);
                            }}
                            className="text-indigo-600 hover:underline font-bold bg-transparent border-0 cursor-pointer p-0 inline-block focus:outline-hidden"
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
                            className="text-indigo-600 hover:underline font-bold bg-transparent border-0 cursor-pointer p-0 inline-block focus:outline-hidden"
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
                            className="text-[10px] text-slate-500 leading-relaxed bg-white border border-slate-100 rounded p-2 space-y-1 shadow-2xs overflow-hidden"
                          >
                            <div className="font-bold text-slate-800">Terms Highlights:</div>
                            <ul className="list-disc list-inside space-y-0.5 pl-0.5">
                              <li>Must be 18 years or older to connect.</li>
                              <li>No explicit, racial, or offensive behavior.</li>
                              <li>Protect your identity; do not share sensitive details.</li>
                            </ul>
                          </motion.div>
                        )}

                        {showPrivacyDetail && (
                          <motion.div
                            key="privacy-highlights"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="text-[10px] text-slate-500 leading-relaxed bg-white border border-slate-100 rounded p-2 space-y-1 shadow-2xs overflow-hidden"
                          >
                            <div className="font-bold text-slate-800">Privacy Highlights:</div>
                            <ul className="list-disc list-inside space-y-0.5 pl-0.5">
                              <li>Highly secure peer-to-peer (P2P) matching.</li>
                              <li>Text history is completely deleted upon lobby exit.</li>
                              <li>No storing or recording of stream data.</li>
                            </ul>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Highly Compact matching start trigger button */}
                    <button
                      id="btn-start-matching"
                      onClick={handleStartMatching}
                      disabled={!agreedToTerms}
                      className={`w-full h-11 text-white text-xs font-extrabold tracking-wider uppercase rounded-lg transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer ${
                        agreedToTerms
                          ? "bg-linear-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 hover:shadow-lg"
                          : "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none border border-slate-150"
                      }`}
                    >
                      <span>Start Chatting</span>
                      <Sparkles className="w-3.5 h-3.5 text-sky-200" />
                    </button>

                    {isInsideIframe && mode === "video" && (
                      <div className="bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-lg text-[10px] text-amber-700 leading-normal font-medium text-center space-y-0.5 mt-0.5">
                        <div>
                          ⚠️ Sandbox restrictions detected. Dual-RTC may require visiting directly.
                        </div>
                        <div>
                          <a
                            href={typeof window !== "undefined" ? window.location.href : "#"}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-indigo-600 hover:underline font-bold"
                          >
                            Open in a Secure New Tab ↗
                          </a>
                        </div>
                      </div>
                    )}
                  </div>

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
                  <AdContainer idKey="e3b922214b1e162ec763d9f9c81590e1" width={300} height={250} className="rounded-xl border border-slate-100 bg-white shadow-2xs" />
                </div>

              </div>

              {/* Right Skyscraper banner */}
              <div className="hidden xl:flex fixed right-5 top-[110px] flex-col items-center justify-center w-[160px] h-[600px] shrink-0 border border-slate-200 rounded-2xl bg-white shadow-md text-center select-none overflow-hidden z-40">
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
                className={mode === "text" ? "flex-grow flex-1 h-full w-full flex flex-col outline-hidden bg-slate-50 min-h-0 overflow-hidden" : "flex-grow flex-1 h-full w-full relative flex flex-col lg:grid lg:grid-cols-2 outline-hidden bg-slate-900 min-h-0 overflow-hidden"}
              >
                {/* Media pane (left column: custom video feed, only shown in video mode!) */}
                {mode === "video" && (
                  <div className="h-[200px] xs:h-[240px] sm:h-[280px] md:h-[320px] lg:h-full w-full relative lg:top-auto lg:right-auto lg:z-auto lg:rounded-none lg:border-none lg:shadow-none border-b border-slate-800/80 flex flex-col shrink-0 min-h-0">
                    <VideoPlayer
                      localStream={localStream}
                      remoteStream={remoteStream}
                      remoteStreamVersion={remoteStreamVersion}
                      isSearching={appState === "searching"}
                      isPaired={appState === "paired"}
                      cameraActive={cameraActive}
                      micActive={micActive}
                      onToggleCamera={handleToggleCamera}
                      onToggleMic={handleToggleMic}
                      mode={mode}
                      webrtcStatus={webrtcStatus}
                      onRetryWebRTC={handleRetryWebRTC}
                      remoteVideoFrame={remoteVideoFrame}
                    />
                  </div>
                )}

                {/* Chat pane (right column or full width depending on mode) */}
                <div className={mode === "text" ? "flex-grow flex-1 flex flex-col h-full w-full bg-slate-50 min-h-0 overflow-hidden" : "flex-grow flex-1 h-auto lg:h-full w-full flex flex-col min-h-0 overflow-hidden"}>
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
