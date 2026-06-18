import { useState, useEffect, useRef, KeyboardEvent } from "react";
import { io, Socket } from "socket.io-client";
import { motion, AnimatePresence } from "motion/react";
import { Message, AppState } from "./types";
import VideoPlayer from "./components/VideoPlayer";
import ChatPanel from "./components/ChatPanel";
import AdContainer from "./components/AdContainer";
import AdManager from "./components/AdManager";
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
  ArrowLeft,
  Volume2
} from "lucide-react";

const POPULAR_SUGGESTIONS = [
  "gaming", "music", "coding", "movies", "anime", "books", "art", "sports", "tech", "singing"
];

export default function App() {
  // Core Selection Preferences
  const [interests, setInterests] = useState<string[]>([]);
  const [interestInput, setInterestInput] = useState("");
  const [mode, setMode] = useState<"text" | "voice" | "video">("text");
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
  const [confirmedAge, setConfirmedAge] = useState<boolean>(false);
  const [agreementError, setAgreementError] = useState<string | null>(null);
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
  const [showSocketFallback, setShowSocketFallback] = useState<boolean>(false);

  // References
  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const lastPlayedAudioTrackIdsRef = useRef<string[]>([]);
  const modeRef = useRef<"text" | "voice" | "video">(mode);
  const partnerIdRef = useRef<string | null>(partnerId);
  const signalProcessingQueueRef = useRef<{ signal: any; from: string }[]>([]);
  const isProcessingQueueRef = useRef<boolean>(false);
  const pendingRemoteCandidatesRef = useRef<any[]>([]);
  const isInitiatorRef = useRef<boolean>(false);
  const iceServersRef = useRef<RTCIceServer[]>([]);

  // Sequenced fallback audio queue references to eliminate playback overlapping stutter
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingAudioQueueRef = useRef<boolean>(false);
  const currentPlayingAudioRef = useRef<HTMLAudioElement | null>(null);

  // Sync refs to avoid stale closures in socket events
  const appStateRef = useRef<AppState>(appState);

  useEffect(() => {
    const loadGithubIceServers = () => {
      const fallbackServers: RTCIceServer[] = [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        { urls: "stun:stun.ekiga.net" },
        {
          urls: "turns:openrelay.metered.ca:443?transport=tcp",
          username: "openrelayproject",
          credential: "openrelayproject"
        },
        {
          urls: "turn:openrelay.metered.ca:3478?transport=udp",
          username: "openrelayproject",
          credential: "openrelayproject"
        }
      ];
      console.log("[WebRTC] Initialized fast, high-availability STUN and TURN configurations.");
      iceServersRef.current = fallbackServers;
    };
    loadGithubIceServers();
  }, []);

  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

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

  // Delay/gate custom WebSocket media relaying from starting during initial setup to keep candidate channels clear
  useEffect(() => {
    if (appState !== "paired" || mode !== "video") {
      setShowSocketFallback(false);
      return;
    }

    // Stop manual fallback immediately if standard PeerConnection succeeds
    if (webrtcStatus === "connected" || webrtcStatus === "completed") {
      setShowSocketFallback(false);
      return;
    }

    // Activate immediately if standard PeerConnection explicitly reports failure
    if (webrtcStatus === "failed") {
      setShowSocketFallback(true);
      return;
    }

    // Allow a 4.5-second grace period for WebRTC peers to establish a P2P connection,
    // otherwise activate WebSocket media fallback instantly so the user never sees a black list/freeze!
    const timer = setTimeout(() => {
      if (webrtcStatus !== "connected" && webrtcStatus !== "completed") {
        console.log("[MediaRelay] WebRTC connection did not establish within 4.5 seconds. Activating seamless WebSocket media fallback.");
        setShowSocketFallback(true);
      }
    }, 4500);

    return () => clearTimeout(timer);
  }, [appState, mode, webrtcStatus]);

  // Seamless Custom Socket-based Media Relaying & Fallback Engine
  useEffect(() => {
    let videoIntervalId: any = null;
    let audioRecorder: MediaRecorder | null = null;

    const currentPartner = partnerId;
    const socket = socketRef.current;
    
    // We only stream if paired, video mode is active, socket is up, AND fallback has been explicitly triggered
    if (appState !== "paired" || mode !== "video" || !currentPartner || !socket || !showSocketFallback) {
      return;
    }

    // Smart fallback behavior: If WebRTC is successfully connected or completed,
    // we suspend the canvas screenshot rendering and the audio recording.
    // This stops massive base64 transfers over WebSocket, freeing 100% of CPU and network bandwidth
    // to let standard high-performance, synchronous WebRTC streams function without lag or stutter.
    if (webrtcStatus === "connected" || webrtcStatus === "completed") {
      console.log("[MediaRelay] Pure WebRTC is active and connected. Suspending manual socket media relaying.");
      setRemoteVideoFrame(null);
      return;
    }

    console.log("[MediaRelay] WebRTC is negotiating/connecting/failed. Activating custom socket-based media relay fallbacks...");

    // 1. Video Frame capturing (every ~220ms, highly optimized yet network-light!)
    if (cameraActive && localStream) {
      const offscreenCanvas = document.createElement("canvas");
      offscreenCanvas.width = 180;
      offscreenCanvas.height = 135;
      const ctx = offscreenCanvas.getContext("2d");

      videoIntervalId = setInterval(() => {
        const localVideoEl = document.getElementById("local-video") as HTMLVideoElement;
        if (localVideoEl && !localVideoEl.paused && !localVideoEl.ended && ctx) {
          try {
            ctx.drawImage(localVideoEl, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
            const base64Frame = offscreenCanvas.toDataURL("image/jpeg", 0.25); // ultra highly compressed small JPEG to avoid buffer jams
            socket.emit("webrtc-signal", {
              to: currentPartner,
              signal: { mediaFrame: base64Frame }
            });
          } catch (e) {
            console.warn("[MediaRelay] Error rendering local video frame:", e);
          }
        }
      }, 220); // optimized low-band screenshot rate to avoid CPU/websocket jams and keep audio in sync
    }

    // 2. Audio chunks capturing/encoding (running in independent 350ms low-latency burst recorder loops)
    let audioLoopActive = true;
    let pendingTimeoutId: any = null;
    let currentRecorder: MediaRecorder | null = null;

    const startRecordingBurst = () => {
      const pc = pcRef.current;
      const isWebRTCActive = !!(pc && (
        pc.connectionState === "connected" || 
        pc.iceConnectionState === "connected" || 
        pc.connectionState === "completed" || 
        pc.iceConnectionState === "completed"
      ));
      if (!audioLoopActive || !micActive || !localStream || isWebRTCActive) {
        return;
      }

      const audioTracks = localStream.getAudioTracks();
      if (audioTracks.length === 0) return;

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
          // ignore check errors
        }

        const recorder = new MediaRecorder(
          recordStream,
          mimeOption ? { mimeType: mimeOption } : undefined
        );
        currentRecorder = recorder;

        const chunks: Blob[] = [];
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            chunks.push(event.data);
          }
        };

        recorder.onstop = () => {
          const pc = pcRef.current;
          const isWebRTCActiveNow = !!(pc && (
            pc.connectionState === "connected" || 
            pc.iceConnectionState === "connected" || 
            pc.connectionState === "completed" || 
            pc.iceConnectionState === "completed"
          ));

          if (chunks.length > 0 && !isWebRTCActiveNow) {
            const audioBlob = new Blob(chunks, { type: chunks[0].type || "audio/webm" });
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64Audio = reader.result as string;
              if (socket && partnerIdRef.current === currentPartner) {
                // Double check WebRTC state right before sending
                const finalPc = pcRef.current;
                const finalWebRTCActive = !!(finalPc && (
                  finalPc.connectionState === "connected" || 
                  finalPc.iceConnectionState === "connected" || 
                  finalPc.connectionState === "completed" || 
                  finalPc.iceConnectionState === "completed"
                ));
                if (!finalWebRTCActive) {
                  socket.emit("webrtc-signal", {
                    to: currentPartner,
                    signal: { mediaAudioChunk: base64Audio }
                  });
                }
              }
            };
            reader.readAsDataURL(audioBlob);
          }

          // Trigger next slice if active and standard WebRTC is still not alive
          if (audioLoopActive && !isWebRTCActiveNow) {
            pendingTimeoutId = setTimeout(startRecordingBurst, 10);
          }
        };

        recorder.start();

        // Let the burst record for exactly 350ms to get beautiful, low-latency independent audio chunks with perfect headers
        pendingTimeoutId = setTimeout(() => {
          if (recorder.state !== "inactive") {
            try {
              recorder.stop();
            } catch (err) {
              // ignore
            }
          }
        }, 350);

      } catch (recorderErr) {
        console.error("[MediaRelay] Blocked audio recording slice:", recorderErr);
        if (audioLoopActive) {
          pendingTimeoutId = setTimeout(startRecordingBurst, 500);
        }
      }
    };

    if (micActive && localStream) {
      startRecordingBurst();
    }

    return () => {
      console.log("[MediaRelay] Cleared local media socket fallbacks.");
      if (videoIntervalId) {
        clearInterval(videoIntervalId);
      }
      audioLoopActive = false;
      if (pendingTimeoutId) {
        clearTimeout(pendingTimeoutId);
      }
      if (currentRecorder && currentRecorder.state !== "inactive") {
        try {
          currentRecorder.stop();
        } catch (stopErr) {
          // ignore
        }
      }
    };
  }, [appState, partnerId, mode, cameraActive, micActive, localStream, webrtcStatus, showSocketFallback]);

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
            // If the responder's PeerConnection doesn't exist or is closed, we instantiate/recreate it safely.
            // We do NOT destroy/recreate for "failed" or "disconnected" because these can naturally be recovered by ICE Restarts on the same PeerConnection!
            if (!activePc || activePc.signalingState === "closed" || activePc.connectionState === "closed") {
              console.log("[WEBRTC] Receiver's PeerConnection is stale/failed. Re-instantiating responder connection before applying offer...");
              await initiateWebRTCPeer(from, false);
              activePc = pcRef.current;
            }
            if (activePc) {
              console.log("[SIGNALING] Calling setRemoteDescription with remote offer");
              try {
                // Boost content quality and buffer limits of received offer
                const optimizedSdp = setMediaBitrates(signal.offer.sdp, 2500, 128);
                const remoteOfferSpec = new RTCSessionDescription({
                  type: "offer",
                  sdp: optimizedSdp
                });
                await activePc.setRemoteDescription(remoteOfferSpec);
                console.log("[SIGNALING] setRemoteDescription (offer) succeeded with boosted bitrates");
              } catch (err) {
                console.error("[SIGNALING] setRemoteDescription (offer) failed:", err);
                throw err;
              }

              console.log("[SIGNALING] Calling createAnswer");
              let answer;
              try {
                // Explicitly request audio & video receiving capabilities
                answer = await activePc.createAnswer({
                  offerToReceiveAudio: true,
                  offerToReceiveVideo: true
                });
                console.log("[SIGNALING] createAnswer succeeded:", answer);
              } catch (err) {
                console.error("[SIGNALING] createAnswer failed:", err);
                throw err;
              }

              console.log("[SIGNALING] Calling setLocalDescription with generated answer");
              try {
                // Custom boost answer SDP quality configurations
                const optimizedSdp = setMediaBitrates(answer.sdp!, 2500, 128);
                const localAnswerSpec = new RTCSessionDescription({
                  type: "answer",
                  sdp: optimizedSdp
                });
                await activePc.setLocalDescription(localAnswerSpec);
                console.log("[SIGNALING] setLocalDescription (answer) succeeded with boosted bitrates");
              } catch (err) {
                console.error("[SIGNALING] setLocalDescription (answer) failed:", err);
                throw err;
              }

              // Send the high-quality SDP Answer back
              const finalAnswerToSend = {
                type: "answer",
                sdp: setMediaBitrates(answer.sdp!, 2500, 128)
              };
              socketRef.current?.emit("webrtc-signal", {
                to: from,
                signal: { answer: finalAnswerToSend }
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
                // Boost description values for received answer
                const optimizedSdp = setMediaBitrates(signal.answer.sdp, 2500, 128);
                const remoteAnswerSpec = new RTCSessionDescription({
                  type: "answer",
                  sdp: optimizedSdp
                });
                await pc.setRemoteDescription(remoteAnswerSpec);
                console.log("[SIGNALING] setRemoteDescription (answer) succeeded with boosted bitrates");
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
                  
                  console.log("[SIGNALING] Calling setLocalDescription with optimized SDP bitrates");
                  const optimizedSdp = setMediaBitrates(offer.sdp!, 2500, 128);
                  const localOfferSpec = new RTCSessionDescription({
                    type: "offer",
                    sdp: optimizedSdp
                  });
                  await activePc.setLocalDescription(localOfferSpec);
                  console.log("[SIGNALING] setLocalDescription (offer) succeeded");

                  const finalOfferToSend = {
                    type: "offer",
                    sdp: optimizedSdp
                  };
                  socketRef.current?.emit("webrtc-signal", {
                    to: from,
                    signal: { offer: finalOfferToSend }
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

  const stopAndClearFallbackAudio = () => {
    if (currentPlayingAudioRef.current) {
      try {
        console.log("[AudioRelay] Actively silencing and stopping playing fallback audio chunk to eliminate echo.");
        currentPlayingAudioRef.current.pause();
        currentPlayingAudioRef.current.src = "";
      } catch (err) {
        console.warn("[AudioRelay] Error pausing playing audio reference:", err);
      }
      currentPlayingAudioRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingAudioQueueRef.current = false;
  };

  // Process sequentially queued base64 voice slices to eliminate playback overlapping stutter
  const playNextAudioQueueChunk = () => {
    const pc = pcRef.current;
    const isWebRTCActive = (pc && (
      pc.connectionState === "connected" || 
      pc.iceConnectionState === "connected" || 
      pc.connectionState === "completed" || 
      pc.iceConnectionState === "completed"
    )) || !!remoteStream;
    if (isWebRTCActive) {
      stopAndClearFallbackAudio();
      return;
    }

    // Dynamic backlog pruning: if more than 2 chunks build up, keep only the latest 1
    // to instantly drop stale buffer delay and sync in true real-time.
    if (audioQueueRef.current.length > 2) {
      console.log(`[AudioRelay] Low latency sync: dropping ${audioQueueRef.current.length - 1} stale chunk(s) to restore lowest lag.`);
      audioQueueRef.current = audioQueueRef.current.slice(-1);
    }

    if (audioQueueRef.current.length === 0) {
      isPlayingAudioQueueRef.current = false;
      return;
    }

    isPlayingAudioQueueRef.current = true;
    const nextChunk = audioQueueRef.current.shift();
    if (!nextChunk) {
      playNextAudioQueueChunk();
      return;
    }

    try {
      const audio = new Audio(nextChunk);
      currentPlayingAudioRef.current = audio;
      audio.volume = 1.0;
      audio.onended = () => {
        if (currentPlayingAudioRef.current === audio) {
          currentPlayingAudioRef.current = null;
        }
        playNextAudioQueueChunk();
      };
      audio.onerror = () => {
        console.warn("[AudioRelay] Failed playing audio chunk from queue, skipping...");
        if (currentPlayingAudioRef.current === audio) {
          currentPlayingAudioRef.current = null;
        }
        playNextAudioQueueChunk();
      };
      audio.play().then(() => {
        // Successfully playing
      }).catch((err) => {
        console.log("[AudioRelay] Playback deferred:", err.message);
        if (currentPlayingAudioRef.current === audio) {
          currentPlayingAudioRef.current = null;
        }
        // If playback was deferred (e.g. user gesture block), retry in next cycle or skip
        // to prevent blocking the queue.
        setTimeout(playNextAudioQueueChunk, 800);
      });
    } catch (err) {
      console.error("[AudioRelay] Audio creation error in queue:", err);
      playNextAudioQueueChunk();
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
      if (appStateRef.current === "landing") return;
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

      // If user selected Video or Voice mode, instantly negotiate WebRTC peer stream
      if (modeRef.current === "video" || modeRef.current === "voice") {
        await initiateWebRTCPeer(peerId, initiator);
      }
    });

    // Handle instant incoming messages
    socket.on("chat-message", ({ text }: { text: string }) => {
      if (appStateRef.current === "landing") return;
      addMessage("stranger", text);
    });

    // Handle typing status indications
    socket.on("typing", ({ isTyping }: { isTyping: boolean }) => {
      if (appStateRef.current === "landing") return;
      setStrangerIsTyping(isTyping);
    });

    // WebRTC signaling relay callback
    socket.on("webrtc-signal", ({ from, signal }) => {
      if (appStateRef.current === "landing") return;
      const currentPartner = partnerIdRef.current;
      if (from !== currentPartner) return;
      
      if (signal && signal.mediaFrame) {
        // Only set the fallback remote frame if standard WebRTC P2P is not yet active
        const pc = pcRef.current;
        const isWebRTCActive = !!(pc && (
          pc.connectionState === "connected" || 
          pc.iceConnectionState === "connected" || 
          pc.connectionState === "completed" || 
          pc.iceConnectionState === "completed"
        ));
        if (!isWebRTCActive) {
          setRemoteVideoFrame(signal.mediaFrame);
        }
      } else if (signal && signal.mediaAudioChunk) {
        // Enqueue fallback audio chunks sequentially if standard WebRTC status is not yet active
        const pc = pcRef.current;
        const isWebRTCActive = !!(pc && (
          pc.connectionState === "connected" || 
          pc.iceConnectionState === "connected" || 
          pc.connectionState === "completed" || 
          pc.iceConnectionState === "completed"
        ));
        if (!isWebRTCActive) {
          audioQueueRef.current.push(signal.mediaAudioChunk);
          if (!isPlayingAudioQueueRef.current) {
            playNextAudioQueueChunk();
          }
        } else {
          // If WebRTC took over, immediately silence and discard any trailing fallback audio chunks to prevent echo
          stopAndClearFallbackAudio();
        }
      } else {
        enqueueSignal(signal, from);
      }
    });

     // Handle sudden stranger disconnects or leaves
    socket.on("stranger-disconnected", () => {
      if (appStateRef.current === "landing") return;
      cleanPeerConnection();
      trackEvent("match_disconnected", { mode: modeRef.current });
      if (autoConnectRef.current) {
        setTimeout(() => {
          handleSkipMatch();
        }, 1500);
      } else {
        setAppState("idle");
      }
    });

    // Socket fallback status logs
    socket.on("disconnect", () => {
      cleanPeerConnection();
      if (appStateRef.current !== "landing") {
        setAppState("idle");
      }
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
  const requestLocalStream = async (overrideMode?: "text" | "voice" | "video"): Promise<MediaStream | null> => {
    setIsStreamLoading(true);
    let resolvedStream: MediaStream | null = null;
    const activeMode = overrideMode || modeRef.current;
    const wantsVideo = activeMode === "video";

    try {
      const constraints: MediaStreamConstraints = wantsVideo ? {
        video: {
          width: { ideal: 640, max: 640 },
          height: { ideal: 360, max: 360 },
          frameRate: { ideal: 15, max: 15 },
          facingMode: "user"
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      } : {
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      setLocalStream(stream);
      setCameraActive(wantsVideo);
      setMicActive(true);
      resolvedStream = stream;
      return stream;
    } catch (err) {
      console.warn("Optimized media stream denied, attempting standard video+audio fallback...", err);
      try {
        const constraintsFallback: MediaStreamConstraints = wantsVideo ? {
          video: {
            width: { ideal: 640, max: 640 },
            height: { ideal: 360, max: 360 },
            frameRate: { ideal: 15, max: 15 },
            facingMode: "user"
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        } : {
          video: false,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraintsFallback);
        localStreamRef.current = stream;
        setLocalStream(stream);
        setCameraActive(wantsVideo);
        setMicActive(true);
        resolvedStream = stream;
        return stream;
      } catch (err15) {
        console.warn("Standard fallback failed, attempting video-only/voice fallbacks...", err15);
        try {
          if (wantsVideo) {
            // Fallback 1: Video-only if microphone is blocked or missing (extremely loose constraint for absolute compatibility)
            const stream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false
            });
            localStreamRef.current = stream;
            setLocalStream(stream);
            setCameraActive(true);
            setMicActive(false);
            resolvedStream = stream;
            return stream;
          } else {
            throw new Error("Voice only mode has no video fallback.");
          }
        } catch (err2) {
          try {
            // Fallback 2: Audio-only if webcam is blocked or missing (or always for voice)
            const stream = await navigator.mediaDevices.getUserMedia({
              video: false,
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
              }
            });
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
      // Find matching transceiver by kind
      const transceivers = pc.getTransceivers();
      const matchingTransceiver = transceivers.find(
        (t) => (t.sender && t.sender.track === track) ||
               (t.receiver && t.receiver.track && t.receiver.track.kind === track.kind) ||
               (t.sender && !t.sender.track && t.receiver && t.receiver.track && t.receiver.track.kind === track.kind) ||
               (t.mid === null && t.direction === "recvonly")
      );

      if (matchingTransceiver && matchingTransceiver.sender) {
        if (matchingTransceiver.sender.track !== track) {
          console.log(`[WebRTC] Reusing existing transceiver to attach local track of kind "${track.kind}".`);
          try {
            await matchingTransceiver.sender.replaceTrack(track);
            matchingTransceiver.direction = "sendrecv";
            changed = true;
          } catch (replaceErr) {
            console.warn(`[WebRTC] Error calling replaceTrack for kind "${track.kind}":`, replaceErr);
          }
        } else if (matchingTransceiver.direction !== "sendrecv") {
          matchingTransceiver.direction = "sendrecv";
          changed = true;
        }
      } else {
        const alreadyAdded = senders.some((s) => s.track === track || (s.track && s.track.id === track.id));
        if (!alreadyAdded) {
          console.log(`[WebRTC] Attaching track ${track.kind} of local stream to existing PeerConnection via addTrack.`);
          try {
            pc.addTrack(track, stream);
            changed = true;
          } catch (addError) {
            console.warn("[WebRTC] Error adding track dynamically:", addError);
          }
        }
      }
    }

    applyWebRTCOptimizations(pc);

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
        const optimizedSdp = setMediaBitrates(offer.sdp!, 2500, 128);
        const localOfferSpec = new RTCSessionDescription({
          type: "offer",
          sdp: optimizedSdp
        });
        await pc.setLocalDescription(localOfferSpec);
        
        socketRef.current?.emit("webrtc-signal", {
          to: partnerIdRef.current,
          signal: { offer: { type: "offer", sdp: optimizedSdp } }
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

  // Enforces sender-level transmission policies: 300 kbps limitations, adaptive degradation, and audio-first prioritizing
  const applyWebRTCOptimizations = (pc: RTCPeerConnection) => {
    try {
      console.log("[WebRTC Optimizations] Securing connection transmission settings...");
      
      const conn = (navigator as any).connection;
      const isWeakNetwork = !!(conn && (conn.saveData || conn.effectiveType === "2g" || conn.effectiveType === "3g" || conn.effectiveType === "slow-2g"));
      const maxVideoBitrate = isWeakNetwork ? 150 * 1000 : 300 * 1000; // Limit video to 150 kbps on weak networks, otherwise 300 kbps max
      
      // 1. Prioritize audio over video and limit video bitrate & framerate via RTCRtpSender.setParameters
      pc.getSenders().forEach((sender) => {
        if (!sender.track) return;
        
        try {
          const params = sender.getParameters();
          // Initialize encodings if missing/empty
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }

          if (sender.track.kind === "video") {
            params.encodings.forEach((encoding) => {
              // Limit video bitrate to 300 kbps (or lower on weak networks)
              encoding.maxBitrate = maxVideoBitrate;
              
              // Reduce frame rate to 15 fps
              encoding.maxFramerate = 15;
              
              // Prioritize audio over video (assign low priority/low network-priority to video)
              encoding.priority = "low";
              encoding.networkPriority = "low";
              
              // Enable adaptive degradation / scaling under congestion
              encoding.scaleResolutionDownBy = 1.0; 
            });
            
            sender.setParameters(params)
              .then(() => console.log(`[WebRTC Optimizations] Video parameters applied: ${maxVideoBitrate / 1000} kbps max, 15 fps max, low priority.`))
              .catch((err) => console.warn("[WebRTC Optimizations] Failed to set video sender parameters:", err));
              
          } else if (sender.track.kind === "audio") {
            params.encodings.forEach((encoding) => {
              // Prioritize audio over video (assign high priority/high network-priority to audio)
              encoding.priority = "high";
              encoding.networkPriority = "high";
            });
            
            sender.setParameters(params)
              .then(() => console.log("[WebRTC Optimizations] Audio parameters applied: high priority, packet-loss resilient."))
              .catch((err) => console.warn("[WebRTC Optimizations] Failed to set audio sender parameters:", err));
          }
        } catch (paramErr) {
          console.warn("[WebRTC Optimizations] Error modifying sender parameters:", paramErr);
        }
      });

      // 2. Adjust transceiver degradationPreference for adaptive resolution scaling on congested/weak links
      pc.getTransceivers().forEach((transceiver) => {
        if (transceiver.sender && transceiver.sender.track && transceiver.sender.track.kind === "video") {
          try {
            // "maintain-framerate" automatically drops video quality (resolution) on weak/congested networks to preserve smooth frames & prioritize audio
            (transceiver as any).degradationPreference = "maintain-framerate";
            console.log("[WebRTC Optimizations] Video transceiver degradation preference set to 'maintain-framerate'.");
          } catch (degradeErr) {
            console.warn("[WebRTC Optimizations] Failed to set transceiver.degradationPreference:", degradeErr);
          }
        }
      });
    } catch (err) {
      console.error("[WebRTC Optimizations] Error running peer optimizations:", err);
    }
  };

  // SDP bandwidth/bitrate modifier to lock in fluid low-latency video and noise-cancelled mono voice
  const setMediaBitrates = (sdp: string, _videoBitrateKbps: number, _audioBitrateKbps: number): string => {
    const videoBitrateKbps = 300; // Limit video bitrate to 300 Kbps max to prevent bufferbloat/congestion
    const audioBitrateKbps = 24;  // 24 Kbps allows robust Opus mono with high FEC capability to preserve voice quality under severe packet loss

    let lines = sdp.split("\r\n");
    let modifiedLines: string[] = [];
    let isVideoSection = false;
    let isAudioSection = false;

    // Find the Opus payload type format lines to inject premium quality parameters
    let opusPayloadType: string | null = null;
    for (let line of lines) {
      if (line.startsWith("a=rtpmap:") && line.toLowerCase().includes("opus/48000")) {
        const match = line.match(/a=rtpmap:(\d+)\s+opus/i);
        if (match) {
          opusPayloadType = match[1];
        }
      }
    }

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      // Detect media section transitions
      if (line.startsWith("m=video")) {
        isVideoSection = true;
        isAudioSection = false;
      } else if (line.startsWith("m=audio")) {
        isVideoSection = false;
        isAudioSection = true;
      } else if (line.startsWith("m=")) {
        isVideoSection = false;
        isAudioSection = false;
      }

      // Check if there are pre-existing bandwidth definitions inside this section and skip them
      if (isVideoSection && (line.startsWith("b=AS:") || line.startsWith("b=TIAS:"))) {
        continue;
      }
      if (isAudioSection && (line.startsWith("b=AS:") || line.startsWith("b=TIAS:") || line.startsWith("a=ptime:") || line.startsWith("a=maxptime:"))) {
        continue;
      }

      // Overwrite Opus media format parameters for seamless, lowest-latency mono voice and standard echo cancellation
      if (isAudioSection && opusPayloadType && line.startsWith(`a=fmtp:${opusPayloadType}`)) {
        // Set stereo=0 and sprop-stereo=0. This lets browser echo-cancellation (AEC) map nicely to the microphone
        // Safely parse and append values without destroying any other browser parameters
        let originalParams = line.substring(`a=fmtp:${opusPayloadType} `.length).trim();
        const paramsToClean = ["stereo", "sprop-stereo", "maxaveragebitrate", "useinbandfec", "usedtx"];
        let parts = originalParams ? originalParams.split(";").map(p => p.trim()).filter(p => {
          const key = p.split("=")[0].trim().toLowerCase();
          return !paramsToClean.includes(key);
        }) : [];
        parts.push("stereo=0");
        parts.push("sprop-stereo=0");
        parts.push("useinbandfec=1");
        parts.push("usedtx=1");
        parts.push(`maxaveragebitrate=${audioBitrateKbps * 1000}`);
        line = `a=fmtp:${opusPayloadType} ${parts.join("; ")}`;
      }

      modifiedLines.push(line);

      // Inject custom bandwidth constraints directly under the media declaration lines
      if (line.startsWith("m=video")) {
        modifiedLines.push(`b=AS:${videoBitrateKbps}`);
        modifiedLines.push(`b=TIAS:${videoBitrateKbps * 1000}`);
      }
      if (line.startsWith("m=audio")) {
        modifiedLines.push(`b=AS:${audioBitrateKbps}`);
        modifiedLines.push(`b=TIAS:${audioBitrateKbps * 1000}`);
        modifiedLines.push("a=ptime:20");
        modifiedLines.push("a=maxptime:20");
      }
    }

    return modifiedLines.join("\r\n");
  };

  // WebRTC Peer connection signaling & establishment
  const initiateWebRTCPeer = async (peerSocketId: string, isInitiator: boolean) => {
    const isSamePartner = (peerSocketId === partnerIdRef.current);

    // Clean existing peer connection
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch (e) {
        console.warn("Error closing old PeerConnection", e);
      }
      pcRef.current = null;
    }

    // If we're pairing with a completely new stranger, perform a full reset.
    // Otherwise, preserve the remote stream and audio element to survive reconnects seamlessly.
    if (!isSamePartner) {
      safeSetRemoteStream(null);
      destroyRemoteAudioElement();
    }

    signalProcessingQueueRef.current = [];
    isProcessingQueueRef.current = false;
    pendingRemoteCandidatesRef.current = [];

    // Configure STUN/TURN servers. Support dynamic production TURN configuration via environment variables
    const customIceServers: RTCIceServer[] = iceServersRef.current.length > 0 
      ? [...iceServersRef.current]
      : [
          // 1. Standard STUN Servers (highly reliable Google infrastructure)
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },

          // 2. High-performance Secure TURN (turns) on port 443 over TCP.
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
    }

    const pc = new RTCPeerConnection({
      iceServers: customIceServers,
      iceTransportPolicy: "all"
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
        stopAndClearFallbackAudio();
        setRemoteVideoFrame(null); // Clear fallback frame
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
        stopAndClearFallbackAudio();
        setRemoteVideoFrame(null); // Clear fallback frame
      }
      if (pc.connectionState === "failed") {
        console.warn("[WEBRTC] PeerConnection failed. Triggering ICE restart...");
        handleIceRestart(peerSocketId, isInitiator);
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

    // Attach local stream tracks to WebRTC pipe safely
    const currentLocalStream = localStreamRef.current;
    if (currentLocalStream && currentLocalStream.getTracks().length > 0) {
      const senders = pc.getSenders();
      currentLocalStream.getTracks().forEach((track) => {
        const alreadyAdded = senders.some((s) => s.track === track || (s.track && s.track.id === track.id) || (s.track && s.track.kind === track.kind));
        if (!alreadyAdded) {
          pc.addTrack(track, currentLocalStream);
        }
      });
    } else {
      // If we don't have local tracks, explicitly declare direction to receive audio and video.
      // This is necessary for Chrome and Safari to correctly negotiate receiving incoming streams 
      // when the local user's camera / microphone access is disabled or not yet resolved.
      try {
        pc.addTransceiver("audio", { direction: "recvonly" });
        if (modeRef.current === "video") {
          pc.addTransceiver("video", { direction: "recvonly" });
        }
      } catch (err) {
        console.warn("[WEBRTC] Failed to add recvonly transceivers:", err);
      }
    }

    // Apply high-availability physical stream transmission and prioritization policies
    applyWebRTCOptimizations(pc);

    // Handle receiving incoming track with high-availability track merging
    pc.ontrack = (event) => {
      console.log(`[WEBRTC] ontrack callback triggered: Kind="${event.track.kind}" | ID="${event.track.id}"`);
      
      let currentStream = remoteStreamRef.current;
      if (!currentStream) {
        // Create a single persistent MediaStream container for this partner session
        console.log("[WEBRTC] Initializing new persistent remote MediaStream container.");
        currentStream = new MediaStream();
        safeSetRemoteStream(currentStream);
      }
      
      const tracks = currentStream.getTracks();
      const alreadyHasTrack = tracks.some((t) => t.id === event.track.id);
      
      if (!alreadyHasTrack) {
        // If we have any existing tracks of the same kind, remove them so the new one takes full priority
        tracks.forEach((t) => {
          if (t.kind === event.track.kind && t.id !== event.track.id) {
            console.log(`[WEBRTC] Stopping and replacing older remote track: kind="${t.kind}" | id="${t.id}"`);
            currentStream?.removeTrack(t);
            try {
              t.stop();
            } catch (err) {
              console.warn("[WEBRTC] Failed to stop older track:", err);
            }
          }
        });

        console.log(`[WEBRTC] Attaching remote track precisely once: kind="${event.track.kind}" | id="${event.track.id}"`);
        currentStream.addTrack(event.track);
        setRemoteStreamVersion((v) => v + 1);
        
        if (event.track.kind === "audio") {
          playRemoteAudioStream(currentStream);
        }
      } else {
        console.log(`[WEBRTC] Track of kind="${event.track.kind}" (id: "${event.track.id}") is already present. Preserving track.`);
      }

      // Ensure that track ending or mute state changes don't detach or unmount the video player.
      event.track.onmute = () => {
        console.log(`[WEBRTC] Track onmute: kind="${event.track.kind}" | id="${event.track.id}". Preserving track attachments and elements.`);
      };
      event.track.onunmute = () => {
        console.log(`[WEBRTC] Track onunmute: kind="${event.track.kind}" | id="${event.track.id}". track live again.`);
        setRemoteStreamVersion((v) => v + 1);
      };
      event.track.onended = () => {
        console.log(`[WEBRTC] Track onended callback: kind="${event.track.kind}" | id="${event.track.id}". Keeping element mounted.`);
      };
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
        
        console.log("[SIGNALING] Initiator: Calling setLocalDescription with optimized SDP bitrates");
        const optimizedSdp = setMediaBitrates(offer.sdp!, 2500, 128);
        const localOfferSpec = new RTCSessionDescription({
          type: "offer",
          sdp: optimizedSdp
        });
        await pc.setLocalDescription(localOfferSpec);
        console.log("[SIGNALING] Initiator: setLocalDescription success");

        const finalOfferToSend = {
          type: "offer",
          sdp: optimizedSdp
        };
        socketRef.current?.emit("webrtc-signal", {
          to: peerSocketId,
          signal: { offer: finalOfferToSend }
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
        const offer = await pc.createOffer({
          iceRestart: true,
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });
        
        const optimizedSdp = setMediaBitrates(offer.sdp!, 2500, 128);
        const localRestartOfferSpec = new RTCSessionDescription({
          type: "offer",
          sdp: optimizedSdp
        });
        await pc.setLocalDescription(localRestartOfferSpec);

        const finalOfferToSend = {
          type: "offer",
          sdp: optimizedSdp
        };
        socketRef.current?.emit("webrtc-signal", {
          to: peerSocketId,
          signal: { offer: finalOfferToSend }
        });
      } catch (err) {
        console.error("Failed to execute ICE restart offer generation:", err);
      }
    }
  };

  const destroyRemoteAudioElement = () => {
    if (remoteAudioElementRef.current) {
      console.log("[Audio] Destroying previous remote audio element to prevent double-playback echo and delay leakage.");
      try {
        remoteAudioElementRef.current.pause();
        remoteAudioElementRef.current.srcObject = null;
        remoteAudioElementRef.current.remove();
      } catch (e) {
        console.warn("[Audio] Error destroying remote audio element:", e);
      }
      remoteAudioElementRef.current = null;
    }
  };

  const playRemoteAudioStream = (stream: MediaStream) => {
    // We now play remote audio directly unmuted inside the VideoPlayer component.
    // This completely eliminates duplicate playback echo, delay leakage, and browser security autoplay blocks.
    console.log("[Audio] Remote stream detected. Audio playback is handled unmuted natively by the VideoPlayer component.");
  };

  const safeSetRemoteStream = (newStream: MediaStream | null) => {
    remoteStreamRef.current = newStream;
    setRemoteStream(newStream);
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
    safeSetRemoteStream(null);
    destroyRemoteAudioElement();
    setRemoteVideoFrame(null);
    partnerIdRef.current = null;
    setPartnerId(null);
    signalProcessingQueueRef.current = []; // Reset queue
    isProcessingQueueRef.current = false;
    pendingRemoteCandidatesRef.current = [];
    setWebrtcStatus("idle");
    stopAndClearFallbackAudio();
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

  // Onboarding verification submit
  const handleOnboardingSubmit = async () => {
    if (!agreedToTerms || !confirmedAge) {
      setAgreementError("Please tick both boxes to agree to the terms and confirm you are 18+.");
      return;
    }
    setAgreementError(null);
    await handleStartMatching(mode);
  };

  // Start search sequence
  const handleStartMatching = async (overrideMode?: "text" | "voice" | "video") => {
    const activeMode = overrideMode || mode;
    if (overrideMode) {
      setMode(overrideMode);
    }
    
    setMessages([]);
    setStrangerIsTyping(false);
    setCommonInterests([]);
    safeSetRemoteStream(null);
    destroyRemoteAudioElement();
    setAppState("searching");

    trackEvent("join_search", { mode: activeMode, interests_count: interests.length, interests });

    if (interests.length > 0) {
      addSystemMessage("please wait while we connect to a random stranger based on your interests");
    } else {
      addSystemMessage("please wait while we connect you to a random stranger");
    }

    // Lazy media setup ahead of routing to maintain flow
    if (activeMode === "video" || activeMode === "voice") {
      await requestLocalStream(activeMode);
    }

    // Ping matching handshake to Express Socket.io server
    initSocketConnection();
    socketRef.current?.emit("start-search", {
      interests,
      mode: activeMode
    });
  };

  // Pause matching (cancel current search and remain in idle chat lobby)
  const handlePauseMatch = () => {
    socketRef.current?.emit("stop-search");
    setAppState("idle");
    cleanPeerConnection();
    trackEvent("match_paused", { mode });
  };

  // Skip partner/Find new pair
  const handleSkipMatch = () => {
    cleanPeerConnection();
    setMessages([]);
    setAppState("searching");

    if (interests.length > 0) {
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
      <nav id="app-navigation" className="bg-white border-b border-slate-100 px-6 py-2 flex items-center justify-between sticky top-0 z-50 shadow-2xs h-[64px] lg:h-[110px] shrink-0">
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
          <div className="h-9 w-9 bg-gradient-to-tr from-sky-400 via-indigo-500 to-indigo-600 rounded-xl flex items-center justify-center text-white font-extrabold tracking-tighter text-lg shadow-md relative overflow-hidden transition-transform duration-300 hover:rotate-[8deg]">
            <span className="rotate-180 inline-block transform scale-110">Ω</span>
            <div className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-emerald-300 rounded-full animate-ping" />
            <div className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-emerald-400 rounded-full" />
          </div>
          <div className="hidden sm:block">
            <h1 className="text-sm font-extrabold tracking-tight text-slate-900 uppercase">Umegle</h1>
            <p className="text-[10px] text-slate-400 font-medium tracking-wide">Secure interest-based video chat</p>
          </div>
        </a>

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
              className="flex-grow flex-1 w-full max-w-[1300px] mx-auto flex flex-row items-center justify-center py-8 px-4 gap-6 relative"
            >
              {/* Modern Ambient Glowing Blobs to make the color theme pop and feel lively */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
                <div className="absolute -top-40 left-1/4 w-[480px] h-[480px] bg-indigo-500/10 rounded-full blur-[110px]" />
                <div className="absolute top-1/2 -right-20 w-[420px] h-[420px] bg-sky-400/12 rounded-full blur-[100px]" />
                <div className="absolute -bottom-40 left-10 w-[380px] h-[380px] bg-rose-400/8 rounded-full blur-[95px]" />
              </div>

              {/* Left Skyscraper banner */}
              <div className="hidden xl:flex fixed left-5 top-[110px] flex-col items-center justify-center w-[160px] h-[600px] shrink-0 border border-slate-200 rounded-2xl bg-white shadow-md text-center select-none overflow-hidden z-40">
                <AdContainer idKey="e8619ab246117925511ef3ee3678d803" width={160} height={600} />
              </div>              {/* Center Dashboard */}
              <div className="flex-grow max-w-2xl w-full mx-auto relative z-10 flex flex-col space-y-4 items-center py-2 sm:py-3">
                
                {/* Hero Section: Brand Intro & Info (Super compact & clean) */}
                <div className="w-full text-center space-y-2 px-2">
                  <div className="inline-flex items-center gap-1.5 bg-gradient-to-r from-indigo-50 to-sky-50 border border-indigo-100/70 rounded-full px-3 py-0.5 text-[10px] text-indigo-700 font-bold shadow-2xs animate-pulse">
                    <Sparkles className="w-3 h-3 text-indigo-500" /> True Anonymous Connections
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 leading-tight">
                    Talk to strangers, <span className="text-linear bg-gradient-to-r from-indigo-600 via-indigo-700 to-sky-500 bg-clip-text text-transparent">completely free.</span>
                  </h2>
                  <p className="text-xs text-slate-505 leading-relaxed max-w-lg mx-auto">
                    Pairs you instantly with random companions worldwide. Filter matches securely by adding search keywords.
                  </p>
                </div>

                {/* Interactive Pairing Box - Sits below the Hero, super-compact for all device screens */}
                <div className="w-full bg-white/95 backdrop-blur-md rounded-xl p-4 sm:p-5 border border-slate-205 shadow-xl shadow-slate-100/40 flex flex-col justify-center space-y-3.5">
                    
                    {/* Part 1: Choose Matching Mode (Highly elegant iOS-style responsive Segmented Control) */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block text-left">1. Select Chat Mode:</span>
                        <span className="text-[10px] font-semibold text-indigo-600 tracking-wide bg-indigo-50 px-2 py-0.5 rounded-md capitalize">
                          {mode} mode
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-200">
                        {/* Option 1: Text */}
                        <button
                          id="mode-option-text"
                          type="button"
                          onClick={() => {
                            setMode("text");
                            setAgreementError(null);
                          }}
                          className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-bold transition-all select-none cursor-pointer ${
                            mode === "text" 
                              ? "bg-indigo-600 text-white shadow-xs" 
                              : "text-slate-600 hover:text-slate-800 hover:bg-slate-150/50"
                          }`}
                        >
                          <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                          <span>Text</span>
                        </button>
                        
                        {/* Option 2: Voice */}
                        <button
                          id="mode-option-voice"
                          type="button"
                          onClick={() => {
                            setMode("voice");
                            setAgreementError(null);
                          }}
                          className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-bold transition-all select-none cursor-pointer ${
                            mode === "voice" 
                              ? "bg-indigo-600 text-white shadow-xs" 
                              : "text-slate-600 hover:text-slate-800 hover:bg-slate-150/50"
                          }`}
                        >
                          <Volume2 className="w-3.5 h-3.5 shrink-0" />
                          <span>Voice</span>
                        </button>

                        {/* Option 3: Webcam */}
                        <button
                          id="mode-option-video"
                          type="button"
                          onClick={() => {
                            setMode("video");
                            setAgreementError(null);
                          }}
                          className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-bold transition-all select-none cursor-pointer ${
                            mode === "video" 
                              ? "bg-indigo-600 text-white shadow-xs" 
                              : "text-slate-600 hover:text-slate-800 hover:bg-slate-150/50"
                          }`}
                        >
                          <Video className="w-3.5 h-3.5 shrink-0" />
                          <span>Webcam</span>
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-500 font-semibold px-1 mt-1 leading-normal text-left transition-all duration-200">
                        {mode === "text" && "📋 Secure, anonymous text chat with matched strangers."}
                        {mode === "voice" && "🎙️ Real-time high quality voice call with instant connection."}
                        {mode === "video" && "📹 Live peer-to-peer webcam streaming. Please remain safe and respectful."}
                      </p>
                    </div>

                    {/* Part 2: Shared Interests tag insertion controls */}
                    <div className="space-y-1.5 text-left">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">2. Add Interests (Optional):</span>
                        {interests.length > 0 && (
                          <button 
                            type="button"
                            onClick={() => setInterests([])}
                            className="text-[10px] font-semibold text-rose-500 hover:text-rose-600 cursor-pointer select-none transition-colors"
                          >
                            Clear All ({interests.length})
                          </button>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex gap-2 items-stretch">
                          <div className="flex-1 bg-slate-50/70 hover:bg-slate-100/50 focus-within:bg-white focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500 border border-slate-205 rounded-xl p-1.5 transition-all flex flex-wrap gap-1 items-center max-h-[85px] overflow-y-auto">
                            {interests.map((item) => (
                              <span
                                key={item}
                                className="inline-flex items-center gap-1 bg-indigo-50 border border-indigo-100 text-indigo-700 text-[10px] font-bold px-1.5 py-0.5 rounded-md animate-fade-in shrink-0"
                              >
                                <span>{item}</span>
                                <button
                                  type="button"
                                  onClick={() => removeInterest(item)}
                                  className="hover:bg-indigo-150 p-0.5 rounded-full text-indigo-500 hover:text-indigo-700 transition-colors cursor-pointer"
                                >
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              </span>
                            ))}
                            <input
                              type="text"
                              placeholder={interests.length > 0 ? "Add tag..." : "Type and press Enter (e.g. music, coding)"}
                              value={interestInput}
                              onChange={(e) => setInterestInput(e.target.value)}
                              onKeyDown={handleInterestKeyDown}
                              className="flex-1 min-w-[120px] bg-transparent border-0 p-0 px-1 text-xs text-slate-850 focus:ring-0 focus:outline-hidden placeholder:text-slate-400 py-1"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => addInterest(interestInput)}
                            className="bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold text-xs px-3.5 py-1.5 rounded-xl transition-all flex items-center justify-center gap-1 shrink-0 cursor-pointer shadow-3xs"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Add</span>
                          </button>
                        </div>
                        {interests.length === 0 && (
                          <p className="text-[10px] text-slate-400 italic font-medium leading-normal px-1">No tags added. Matching random strangers.</p>
                        )}
                      </div>
                    </div>

                    {/* Part 3: Regulatory safety agreement checkboxes */}
                    <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 text-[10.5px] text-slate-600 flex flex-col space-y-2 select-none text-left">
                      <div className="flex items-center gap-1.5 font-bold text-slate-700">
                        <ShieldCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span>3. Safety & Agreement:</span>
                      </div>
                      
                      <div className="flex flex-col space-y-1.5">
                        <label className="flex items-start gap-2 cursor-pointer hover:text-slate-900 transition-colors select-none">
                          <input
                            type="checkbox"
                            checked={confirmedAge && agreedToTerms}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setConfirmedAge(checked);
                              setAgreedToTerms(checked);
                              if (checked) setAgreementError(null);
                            }}
                            className="mt-0.5 rounded-xs border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer accent-indigo-600 shrink-0"
                          />
                          <span className="leading-tight font-medium text-slate-650">
                            I am <span className="font-bold text-slate-800">18+ years of age</span> and accept the <span className="text-indigo-600 hover:underline font-bold" onClick={(e) => { e.preventDefault(); setShowTermsDetail(!showTermsDetail); }}>Terms of Service</span> and <span className="text-indigo-600 hover:underline font-bold" onClick={(e) => { e.preventDefault(); setShowPrivacyDetail(!showPrivacyDetail); }}>Privacy Policy</span>.
                          </span>
                        </label>
                      </div>

                      <AnimatePresence mode="wait">
                        {showTermsDetail && (
                          <motion.div
                            key="terms-highlights"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="text-[9.5px] text-slate-500 leading-relaxed bg-white border border-slate-100 rounded-lg p-2.5 mt-1 text-left space-y-1 shadow-2xs overflow-hidden"
                          >
                            <div className="font-bold text-slate-800">Terms of Use:</div>
                            <ul className="list-disc list-inside space-y-0.5 pl-1">
                              <li>Minimum 18 years age requirement.</li>
                              <li>Sexually explicit, toxic, or offensive behaviors are banned.</li>
                              <li>Protect your identity; avoid sharing contact details.</li>
                            </ul>
                          </motion.div>
                        )}

                        {showPrivacyDetail && (
                          <motion.div
                            key="privacy-highlights"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="text-[9.5px] text-slate-500 leading-relaxed bg-white border border-slate-100 rounded-lg p-2.5 mt-1 text-left space-y-1 shadow-2xs overflow-hidden"
                          >
                            <div className="font-bold text-slate-800">Privacy Policy:</div>
                            <ul className="list-disc list-inside space-y-0.5 pl-1">
                              <li>Streams utilize encrypted peer-to-peer tunnels.</li>
                              <li>Messages are deleted immediately upon lobby exit.</li>
                              <li>We do not record, store, or sell content streams.</li>
                            </ul>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Inline alert if conditions aren't met */}
                    {agreementError && (
                      <motion.div
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-2.5 rounded-lg bg-rose-50 border border-rose-250 text-rose-600 font-bold text-xs text-center flex items-center justify-center gap-1.5"
                      >
                        <Info className="w-3.5 h-3.5 shrink-0" />
                        <span>{agreementError}</span>
                      </motion.div>
                    )}

                    {/* Part 4: Start Chatting Connecting primary CTA button */}
                    <button
                      id="btn-start-connecting"
                      type="button"
                      onClick={handleOnboardingSubmit}
                      className="w-full relative group bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-extrabold text-sm sm:text-base py-2.5 px-4 rounded-xl transition-all duration-300 shadow-md shadow-indigo-500/15 hover:shadow-indigo-500/25 hover:scale-[1.01] flex items-center justify-center gap-2 cursor-pointer select-none"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-indigo-300 group-hover:scale-120 transition-transform" />
                      <span>Start Chatting & Connecting</span>
                    </button>
                  </div>

                  {/* Concise P2P footnote at the very bottom */}
                  <p className="text-[10px] text-slate-400 font-medium text-center">
                    🔒 Chat sessions are fully encrypted P2P. Streams are never cached or stored.
                  </p>

              </div>

              {/* Right Skyscraper banner */}
              <div className="hidden xl:flex fixed right-5 top-[110px] flex-col items-center justify-center w-[160px] h-[600px] shrink-0 border border-slate-200 rounded-2xl bg-white shadow-md text-center select-none overflow-hidden z-40">
                <AdContainer idKey="e8619ab246117925511ef3ee3678d803" width={160} height={600} />
              </div>
            </motion.div>
          ) : (
            // Active Messaging Sandbox Stage with flanking Skyscraper Ads
            <div className={`flex-grow flex-1 flex flex-row w-full max-w-[1720px] mx-auto h-full min-h-0 overflow-hidden ${
              mode !== "text" ? "bg-slate-900" : "bg-slate-50"
            }`}>

              {/* Left Chat Ad Column */}
              <div className={`hidden ${mode !== "text" ? "2xl:flex" : "xl:flex"} flex-col items-center justify-start gap-2 w-[160px] h-full shrink-0 border-r py-3 select-none ${
                mode !== "text" 
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
                className={mode === "text" || mode === "voice" ? "flex-grow flex-1 h-full w-full flex flex-col outline-hidden bg-slate-50 min-h-0 overflow-hidden" : "flex-grow flex-1 h-full w-full relative flex flex-col lg:grid lg:grid-cols-2 outline-hidden bg-slate-900 min-h-0 overflow-hidden"}
              >
                {/* Media pane (left column: custom video feed / compact top voice bar) */}
                {mode !== "text" && (
                  <div className={
                    mode === "voice"
                      ? "h-[60px] sm:h-[72px] w-full relative flex flex-col shrink-0 min-h-0 z-20 border-b border-violet-900/60 bg-violet-950 shadow-sm"
                      : "h-[200px] xs:h-[240px] sm:h-[280px] md:h-[320px] lg:h-full w-full relative lg:top-auto lg:right-auto lg:z-auto lg:rounded-none lg:border-none lg:shadow-none border-b border-slate-800/80 flex flex-col shrink-0 min-h-0"
                  }>
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
                <div className={mode === "text" || mode === "voice" ? "flex-grow flex-1 flex flex-col h-full w-full bg-slate-50 min-h-0 overflow-hidden" : "flex-grow flex-1 h-auto lg:h-full w-full flex flex-col min-h-0 overflow-hidden"}>
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
              <div className={`hidden ${mode !== "text" ? "2xl:flex" : "xl:flex"} flex-col items-center justify-start gap-2 w-[160px] h-full shrink-0 border-l py-3 select-none ${
                mode !== "text" 
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
      <AdManager />
    </div>
  );
}
