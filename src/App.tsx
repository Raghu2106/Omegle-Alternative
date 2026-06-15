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
  const [showSocketFallback, setShowSocketFallback] = useState<boolean>(false);

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

  // Sequenced fallback audio queue references to eliminate playback overlapping stutter
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingAudioQueueRef = useRef<boolean>(false);

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

    // Allow a 1.5-second grace period for WebRTC peers to establish a P2P connection,
    // otherwise activate WebSocket media fallback instantly so the user never sees a black list/freeze!
    const timer = setTimeout(() => {
      if (webrtcStatus !== "connected" && webrtcStatus !== "completed") {
        console.log("[MediaRelay] WebRTC connection did not establish within 1.5 seconds. Activating seamless WebSocket media fallback.");
        setShowSocketFallback(true);
      }
    }, 1500);

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
            const base64Frame = offscreenCanvas.toDataURL("image/jpeg", 0.35); // highly compressed
            socket.emit("webrtc-signal", {
              to: currentPartner,
              signal: { mediaFrame: base64Frame }
            });
          } catch (e) {
            console.warn("[MediaRelay] Error rendering local video frame:", e);
          }
        }
      }, 180); // optimized slide-stream rate (~5.5 fps) to save considerable bandwidth when fallback is active
    }

    // 2. Audio chunks capturing/encoding (running in independent 1.1s burst recorder loops)
    let audioLoopActive = true;
    let pendingTimeoutId: any = null;
    let currentRecorder: MediaRecorder | null = null;

    const startRecordingBurst = () => {
      const pc = pcRef.current;
      const isWebRTCActive = pc && (
        pc.connectionState === "connected" || 
        pc.iceConnectionState === "connected" || 
        pc.connectionState === "completed" || 
        pc.iceConnectionState === "completed"
      );
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
          if (chunks.length > 0) {
            const audioBlob = new Blob(chunks, { type: chunks[0].type || "audio/webm" });
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
            reader.readAsDataURL(audioBlob);
          }

          // Trigger next slice if active
          if (audioLoopActive) {
            pendingTimeoutId = setTimeout(startRecordingBurst, 40);
          }
        };

        recorder.start();

        // Let the burst record for exactly 1.1 seconds to get beautiful, solid, continuous HD audio chunks with headers
        pendingTimeoutId = setTimeout(() => {
          if (recorder.state !== "inactive") {
            try {
              recorder.stop();
            } catch (err) {
              // ignore
            }
          }
        }, 1100);

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
            // If the responder's PeerConnection is failed, disconnected, or closed, we recreate it before applying
            if (!activePc || activePc.connectionState === "failed" || activePc.connectionState === "disconnected" || activePc.connectionState === "closed") {
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

  // Process sequentially queued base64 voice slices to eliminate playback overlapping stutter
  const playNextAudioQueueChunk = () => {
    const pc = pcRef.current;
    const isWebRTCActive = pc && (
      pc.connectionState === "connected" || 
      pc.iceConnectionState === "connected" || 
      pc.connectionState === "completed" || 
      pc.iceConnectionState === "completed"
    );
    if (isWebRTCActive) {
      // Clear queue if stable direct WebRTC has taken over
      audioQueueRef.current = [];
      isPlayingAudioQueueRef.current = false;
      return;
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
      audio.volume = 1.0;
      audio.onended = () => {
        playNextAudioQueueChunk();
      };
      audio.onerror = () => {
        console.warn("[AudioRelay] Failed playing audio chunk from queue, skipping...");
        playNextAudioQueueChunk();
      };
      audio.play().catch((err) => {
        console.log("[AudioRelay] Playback deferred:", err.message);
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
    socket.on("webrtc-signal", ({ from, signal }) => {
      const currentPartner = partnerIdRef.current;
      if (from !== currentPartner) return;
      
      if (signal && signal.mediaFrame) {
        // Only set the fallback remote frame if standard WebRTC P2P is not yet active
        const pc = pcRef.current;
        const isWebRTCActive = pc && (
          pc.connectionState === "connected" || 
          pc.iceConnectionState === "connected" || 
          pc.connectionState === "completed" || 
          pc.iceConnectionState === "completed"
        );
        if (!isWebRTCActive) {
          setRemoteVideoFrame(signal.mediaFrame);
        }
      } else if (signal && signal.mediaAudioChunk) {
        // Enqueue fallback audio chunks sequentially if standard WebRTC status is not yet active
        const pc = pcRef.current;
        const isWebRTCActive = pc && (
          pc.connectionState === "connected" || 
          pc.iceConnectionState === "connected" || 
          pc.connectionState === "completed" || 
          pc.iceConnectionState === "completed"
        );
        if (!isWebRTCActive) {
          audioQueueRef.current.push(signal.mediaAudioChunk);
          if (!isPlayingAudioQueueRef.current) {
            playNextAudioQueueChunk();
          }
        }
      } else {
        enqueueSignal(signal, from);
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
    let resolvedStream: MediaStream | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 24, max: 30 },
          facingMode: "user"
        },
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true }
        }
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
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          },
          audio: {
            echoCancellation: { ideal: true },
            noiseSuppression: { ideal: true },
            autoGainControl: { ideal: true }
          }
        });
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
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30 }
            },
            audio: false
          });
          localStreamRef.current = stream;
          setLocalStream(stream);
          setCameraActive(true);
          setMicActive(false);
          resolvedStream = stream;
          return stream;
        } catch (err2) {
          try {
            // Fallback 2: Audio-only if webcam is blocked or missing
            const stream = await navigator.mediaDevices.getUserMedia({
              video: false,
              audio: {
                echoCancellation: { ideal: true },
                noiseSuppression: { ideal: true },
                autoGainControl: { ideal: true }
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

  // SDP bandwidth/bitrate modifier to lock in crystal-clear high-definition video and robust stereo audio
  const setMediaBitrates = (sdp: string, _videoBitrateKbps: number, _audioBitrateKbps: number): string => {
    const videoBitrateKbps = 1500; // 1.5 Mbps is outstanding for smooth 720p HD stream and prevents packet choke on constrained relays
    const audioBitrateKbps = 64;   // 64 Kbps is excellent HD stereo sound representation for crystal clear voice calls

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
      if (isAudioSection && (line.startsWith("b=AS:") || line.startsWith("b=TIAS:"))) {
        continue;
      }

      // Overwrite Opus media format parameters to unlock maximum quality
      if (isAudioSection && opusPayloadType && line.startsWith(`a=fmtp:${opusPayloadType}`)) {
        // Boost Opus config safely with inband FEC (Forward Error Correction) and robust bitrates
        line = `a=fmtp:${opusPayloadType} useinbandfec=1;stereo=1;sprop-stereo=1;usedtx=1;maxaveragebitrate=${audioBitrateKbps * 1000}`;
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
      }
    }

    return modifiedLines.join("\r\n");
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
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        console.warn("[WEBRTC] PeerConnection failed or disconnected. Triggering ICE restart...");
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
          <div className="h-9 w-9 bg-linear-to-tr from-sky-400 via-indigo-500 to-emerald-400 rounded-xl flex items-center justify-center text-white font-extrabold tracking-tighter text-lg shadow-md relative overflow-hidden">
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
              className="flex-grow flex-1 w-full max-w-[1300px] mx-auto flex flex-row items-center justify-center py-8 px-4 gap-6"
            >
              {/* Left Skyscraper banner */}
              <div className="hidden xl:flex fixed left-5 top-[110px] flex-col items-center justify-center w-[160px] h-[600px] shrink-0 border border-slate-200 rounded-2xl bg-white shadow-md text-center select-none overflow-hidden z-40">
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
                          className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col gap-3 select-none ${
                            mode === "video" 
                              ? "border-indigo-600 bg-indigo-50/20" 
                              : "border-slate-100 hover:border-slate-200 bg-slate-50/50"
                          }`}
                        >
                          <div className="flex items-start gap-3.5">
                            <div className={`p-2.5 rounded-lg shrink-0 ${mode === "video" ? "bg-indigo-600 text-white" : "bg-white text-slate-500 border border-slate-200"}`}>
                              <Video className="w-5 h-5" />
                            </div>
                            <div className="space-y-0.5">
                              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Webcam Video & Voice</h4>
                              <p className="text-[11px] text-slate-500 leading-normal">Enable webcam audio & video dynamically with high quality WebRTC tunnels.</p>
                            </div>
                          </div>
                          {isInsideIframe && (
                            <div className="bg-amber-500/10 border border-amber-500/25 px-3 py-2 rounded-lg text-[10px] text-amber-700 leading-relaxed font-bold">
                              ⚠️ Sandbox restriction detected. Real-time video/audio chat requires visiting this app directly in a full secure browser tab.
                            </div>
                          )}
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

                    {isInsideIframe && mode === "video" && (
                      <div className="bg-amber-500/10 border border-amber-500/20 p-3 rounded-lg text-[11px] text-amber-700 leading-normal font-medium text-center space-y-1 mt-1">
                        <div>
                          ⚠️ <strong>Environment Notice:</strong> Sandbox frames (like AI Studio previews) restrict custom browser media routing.
                        </div>
                        <div>
                          If video/audio connection fails, please{" "}
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
