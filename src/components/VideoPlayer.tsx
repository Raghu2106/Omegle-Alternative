import { useEffect, useRef, useState, useCallback } from "react";
import { motion } from "motion/react";
import { Camera, CameraOff, Mic, MicOff, Users, Sparkles, Grid, Layers, Monitor, Maximize2, Minimize2, AlertCircle } from "lucide-react";

interface VideoPlayerProps {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  remoteStreamVersion?: number;
  isSearching: boolean;
  isPaired: boolean;
  cameraActive: boolean;
  micActive: boolean;
  onToggleCamera: () => void;
  onToggleMic: () => void;
  mode: "text" | "video";
  webrtcStatus?: string;
  onRetryWebRTC?: () => void;
  remoteVideoFrame?: string | null;
}

export default function VideoPlayer({
  localStream,
  remoteStream,
  remoteStreamVersion = 0,
  isSearching,
  isPaired,
  cameraActive,
  micActive,
  onToggleCamera,
  onToggleMic,
  mode,
  webrtcStatus,
  onRetryWebRTC,
  remoteVideoFrame = null,
}: VideoPlayerProps) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Dedicated remote audio player binding to guarantee high compatibility and audio routing on all devices
  useEffect(() => {
    if (remoteAudioRef.current && remoteStream && isPaired) {
      const audioTracks = remoteStream.getAudioTracks();
      if (audioTracks.length > 0) {
        console.log("[VideoPlayer] Playing remote audio track via dedicated selector component. Track counts:", audioTracks.length);
        const audioStream = new MediaStream(audioTracks);
        remoteAudioRef.current.srcObject = audioStream;
        remoteAudioRef.current.muted = false;
        remoteAudioRef.current.volume = 1.0;
        
        remoteAudioRef.current.play()
          .then(() => {
            console.log("[VideoPlayer] Dedicated audio playback started successfully.");
          })
          .catch((err) => {
            console.warn("[VideoPlayer] Dedicated audio play deferred:", err);
          });
      } else {
        remoteAudioRef.current.srcObject = null;
      }
    } else if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
  }, [remoteStream, remoteStreamVersion, isPaired]);

  // Flexible Layout modes: "grid" (stacked split), "enlarged" (side-by-side), "pip" (face-time card mode)
  const [layoutMode, setLayoutMode] = useState<"grid" | "enlarged" | "pip">(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth < 1024 ? "pip" : "grid";
    }
    return "grid";
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isVirtualFullscreen, setIsVirtualFullscreen] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [userHasInteracted, setUserHasInteracted] = useState(false);
  const [showLocalControls, setShowLocalControls] = useState(false);
  const [isInsideIframe, setIsInsideIframe] = useState(false);

  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        const framed = window.self !== window.top;
        setIsInsideIframe(framed);
      }
    } catch (e) {
      // In privacy browsers (e.g., Brave) or embedded WebViews, top-level checks can throw.
      // Default to false unless ancestorOrigins explicitly confirms a Google AI Studio frame origin.
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

  const handleRecoverAutoplay = () => {
    setUserHasInteracted(true);
    if (remoteVideoRef.current) {
      remoteVideoRef.current.play()
        .then(() => {
          setAutoplayBlocked(false);
        })
        .catch((err) => {
          console.error("Direct play recovery failed:", err);
        });
    }
  };

  const localVideoCallback = useCallback((el: HTMLVideoElement | null) => {
    localVideoRef.current = el;
    if (el && localStream) {
      if (el.srcObject !== localStream) {
        console.log("[VideoPlayer] Binding localStream to video element via callback ref");
        el.srcObject = localStream;
      }
      el.play().catch((err) => {
        console.warn("[VideoPlayer] Local video play failed in callback ref: ", err);
      });
    }
  }, [localStream]);

  const remoteVideoCallback = useCallback((el: HTMLVideoElement | null) => {
    remoteVideoRef.current = el;
    if (el && remoteStream) {
      if (el.srcObject !== remoteStream) {
        console.log("[VideoPlayer] Binding remoteStream to video element via callback ref");
        el.srcObject = remoteStream;
      }
      // Force unmuting and set maximum volume to guarantee audio streams are audible
      el.muted = false;
      el.volume = 1.0;
      
      el.play()
        .then(() => {
          setAutoplayBlocked((blocked) => {
            if (blocked) return false;
            return blocked;
          });
        })
        .catch((err) => {
          console.warn("[VideoPlayer] Play call failed inside callback ref:", err);
          if (!userHasInteracted) {
            setAutoplayBlocked((blocked) => {
              if (!blocked) return true;
              return blocked;
            });
          }
        });
    }
  }, [remoteStream, userHasInteracted]);

  // Re-verify on resize or update to ensure mobile and tablet never run in "grid" (Up/Down stacked) mode
  useEffect(() => {
    const handleResize = () => {
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        if (layoutMode === "grid") {
          setLayoutMode("pip");
        }
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [layoutMode]);

  // Monitor browser fullscreen state change
  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      );
      setIsFullscreen(active);
      if (!active) {
        setIsVirtualFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);
    document.addEventListener("MSFullscreenChange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      document.removeEventListener("mozfullscreenchange", handleFullscreenChange);
      document.removeEventListener("MSFullscreenChange", handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;

    if (isVirtualFullscreen) {
      setIsVirtualFullscreen(false);
      return;
    }

    try {
      if (!document.fullscreenElement && 
          !(document as any).webkitFullscreenElement && 
          !(document as any).mozFullScreenElement && 
          !(document as any).msFullscreenElement) {
        const req = containerRef.current.requestFullscreen || 
                    (containerRef.current as any).webkitRequestFullscreen || 
                    (containerRef.current as any).mozRequestFullScreen ||
                    (containerRef.current as any).msRequestFullscreen;
        if (req) {
          await req.call(containerRef.current);
        } else {
          setIsVirtualFullscreen(true);
        }
      } else {
        const exit = document.exitFullscreen || 
                     (document as any).webkitExitFullscreen || 
                     (document as any).mozCancelFullScreen ||
                     (document as any).msExitFullscreen;
        if (exit) {
          await exit.call(document);
        }
      }
    } catch (err) {
      console.warn("Standard Fullscreen API failed or blocked (e.g. inside sandboxed workspace iframe). Falling back to Virtual Fullscreen overlay.", err);
      setIsVirtualFullscreen(true);
    }
  };



  // Keep references updated
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch((err) => {
        console.warn("[VideoPlayer] Local video play failed: ", err);
      });
    }
  }, [localStream, layoutMode, cameraActive]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      // Re-assign srcObject to guarantee browser re-evaluates all tracks (audio/video) when added dynamically on Unified Plan
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play()
        .then(() => {
          setAutoplayBlocked(false);
        })
        .catch((err) => {
          console.warn("[VideoPlayer] Autoplay was blocked/halted by browser:", err);
          if (!userHasInteracted) {
            setAutoplayBlocked(true);
          }
        });
    } else {
      setAutoplayBlocked(false);
    }
  }, [remoteStream, remoteStreamVersion, layoutMode, isPaired, userHasInteracted]);

  // Proactively listen for any document interaction to recover from autoplay blockages
  useEffect(() => {
    if (!autoplayBlocked || !remoteStream) return;

    const tryPlay = () => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.play()
          .then(() => {
            console.log("[VideoPlayer] Autoplay video successfully recovered via user interaction.");
            setAutoplayBlocked(false);
            setUserHasInteracted(true);
          })
          .catch((err) => {
            console.warn("[VideoPlayer] User interaction play recovery attempt failed:", err);
          });
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.play()
          .then(() => {
            console.log("[VideoPlayer] Autoplay audio successfully recovered via user interaction.");
          })
          .catch((err) => {
            console.warn("[VideoPlayer] User interaction audio play recovery attempt failed:", err);
          });
      }
    };

    const events = ["click", "keydown", "mousedown", "touchstart"];
    events.forEach((event) => document.addEventListener(event, tryPlay, { passive: true }));

    return () => {
      events.forEach((event) => document.removeEventListener(event, tryPlay));
    };
  }, [autoplayBlocked, remoteStream]);

  if (mode === "text") {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-linear-to-b from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950 p-8 text-center border-r border-slate-200">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="max-w-md space-y-6"
        >
          <div className="mx-auto w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 shadow-sm border border-indigo-100">
            <Users className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-slate-800">Text-Only Match Mode</h3>
            <p className="text-sm text-slate-500 leading-relaxed">
              You are connected via anonymous text. This saves connection bandwidth, keeps your privacy, and works on any network connection instantly!
            </p>
          </div>
          
          <div className="bg-white rounded-xl p-4 border border-slate-100 text-left space-y-3 shadow-xs">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-600">
              <Sparkles className="w-3.5 h-3.5" /> Quick Tips
            </div>
            <ul className="text-xs text-slate-600 space-y-2 list-disc list-inside">
              <li>Type custom Interests to matching similar minds</li>
              <li>Press <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-[10px] font-semibold border">Esc</kbd> key twice to skip and start next match</li>
              <li>Always comply with community standards and stay respectful</li>
            </ul>
          </div>
        </motion.div>
      </div>
    );
  }

  // Choose container class list helper based on layout preference
  const getContainerClassName = () => {
    let classes = "";
    if (layoutMode === "grid") {
      // Stacked: Up and Down
      classes = "relative grid grid-rows-2 gap-2 h-full max-h-full p-1.5 sm:p-3 bg-slate-900 border-r border-slate-800/60 min-h-0 overflow-hidden";
    } else if (layoutMode === "enlarged") {
      // Side by Side
      classes = "relative grid grid-cols-2 gap-2 h-full max-h-full p-1.5 sm:p-3 bg-slate-900 border-r border-slate-800/60 min-h-0 overflow-hidden";
    } else {
      // "pip" overlay mode
      classes = "relative flex flex-col h-full max-h-full p-1.5 sm:p-3 bg-slate-900 border-r border-slate-800/60 min-h-0 overflow-hidden";
    }

    if (isVirtualFullscreen) {
      classes += " !fixed !inset-0 !w-screen !h-screen !z-[9999] !p-4 sm:p-6 !bg-slate-950 !rounded-none !border-none";
    }
    return classes;
  };

  return (
    <div ref={containerRef} className={getContainerClassName()}>
      {/* Dedicated high-compatibility background audio element for stranger audio stream */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        style={{ display: "none" }}
      />
      
      {/* Floating Iframe Restrictions Alert Bar */}
      {isInsideIframe && (
        <div className="absolute top-14 left-2 right-12 sm:top-[68px] sm:left-4 sm:right-16 z-[45] bg-amber-500/95 backdrop-blur-md text-white text-[10px] sm:text-xs font-bold px-3 py-2 rounded-xl flex items-center justify-between shadow-2xl border border-amber-600/30 gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="shrink-0">⚠️</span>
            <span className="truncate">Sandbox restricted. Video calls require a direct secure tab.</span>
          </div>
          <a
            href={typeof window !== "undefined" ? window.location.href : "#"}
            target="_blank"
            rel="noreferrer noopener"
            className="shrink-0 bg-white hover:bg-slate-50 text-amber-700 font-extrabold px-2.5 py-1 rounded-lg text-[9px] sm:text-[10px] uppercase tracking-wider shadow-sm transition-all text-center select-none cursor-pointer"
          >
            Open New Tab ↗
          </a>
        </div>
      )}
      
      {/* Floating Layout Selector HUD Tag */}
      <div className="absolute top-2 right-2 sm:top-3 sm:right-3 z-40 bg-slate-950/90 backdrop-blur-md border border-slate-800 rounded-xl p-0.5 flex items-center gap-0.5 shadow-xl">
        <button
          type="button"
          onClick={() => setLayoutMode("grid")}
          className={`hidden lg:flex items-center gap-1 text-[10px] sm:text-[11px] font-bold px-1.5 py-1 sm:px-2 sm:py-1.5 rounded-lg transition-all cursor-pointer ${
            layoutMode === "grid"
              ? "bg-indigo-600 text-white"
              : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
          }`}
          title="Equal Split (Up and Down)"
        >
          <Layers className="w-3" />
          <span className="hidden xs:inline sm:inline">Up/Down</span>
        </button>
        <button
          type="button"
          onClick={() => setLayoutMode("enlarged")}
          className={`flex items-center gap-1 text-[10px] sm:text-[11px] font-bold px-1.5 py-1 sm:px-2 sm:py-1.5 rounded-lg transition-all cursor-pointer ${
            layoutMode === "enlarged"
              ? "bg-indigo-600 text-white"
              : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
          }`}
          title="Side-by-Side View"
        >
          <Grid className="w-3" />
          <span className="hidden xs:inline sm:inline">Side/Side</span>
        </button>
        <button
          type="button"
          onClick={() => setLayoutMode("pip")}
          className={`flex items-center gap-1 text-[10px] sm:text-[11px] font-bold px-1.5 py-1 sm:px-2 sm:py-1.5 rounded-lg transition-all cursor-pointer ${
            layoutMode === "pip"
              ? "bg-indigo-600 text-white"
              : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
          }`}
          title="Overlay (PIP)"
        >
          <Monitor className="w-3" />
          <span className="hidden xs:inline sm:inline">Overlay</span>
        </button>
      </div>

      {/* STRANGER VIEW BLOCK */}
      <motion.div 
        layout
        className="relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center transition-all w-full h-full min-h-0"
      >
        {isPaired && (webrtcStatus === "connected" || webrtcStatus === "completed") && remoteStream ? (
          <video
            id="remote-video"
            ref={remoteVideoCallback}
            autoPlay
            playsInline
            muted={false}
            className="w-full h-full object-cover bg-slate-950"
          />
        ) : isPaired && remoteVideoFrame ? (
          <img
            src={remoteVideoFrame}
            className="w-full h-full object-cover bg-slate-950 select-none pointer-events-none"
            alt="Remote Stranger Feed"
          />
        ) : isPaired && remoteStream ? (
          <video
            id="remote-video"
            ref={remoteVideoCallback}
            autoPlay
            playsInline
            muted={false}
            className="w-full h-full object-cover bg-slate-950"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10 p-6 text-center select-none bg-radial from-slate-900 to-slate-950">
            {isSearching ? (
              <div className="space-y-4">
                <div className="relative flex items-center justify-center">
                  <span className="absolute inline-flex h-12 w-12 rounded-full bg-sky-400 opacity-20 animate-ping"></span>
                  <div className="relative rounded-full bg-sky-500 p-3 text-white">
                    <Users className="h-6 w-6 animate-pulse" />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-sky-400 text-sm tracking-widener uppercase">Finding stranger...</p>
                  <p className="text-xs text-slate-400">Matching you based on shared interests</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-full bg-slate-800/80 p-3 mx-auto w-fit text-slate-400 border border-slate-700">
                  <Users className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-slate-300 text-sm">Stranger Video Viewport</p>
                  <p className="text-xs text-slate-500">Pairs will establish video links directly here</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Autoplay blocked recovery overlay (removed as per user request to auto-connect without click prompts) */}

        {/* WebRTC Failed Troubleshooting Overlay */}
        {isPaired && webrtcStatus === "failed" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 backdrop-blur-sm z-30 p-4 text-center">
            {isInsideIframe ? (
              <div className="space-y-3.5 max-w-sm bg-slate-900 border border-rose-500/30 p-5 rounded-2xl shadow-2xl text-left">
                <div className="mx-auto w-10 h-10 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                  <AlertCircle className="w-5 h-5 animate-pulse" />
                </div>
                <div className="space-y-1 text-center">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">WebRTC Connection Blocked</h4>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    Google Chrome prevents custom Peer-to-Peer (P2P) signaling when running inside a sandboxed preview frame.
                  </p>
                </div>
                <div className="text-[10px] text-slate-350 bg-slate-950/50 p-3 rounded-xl border border-slate-800 space-y-1.5 leading-relaxed">
                  <div className="flex gap-1.5">
                    <span className="text-indigo-400 font-extrabold shrink-0">1.</span>
                    <span>Click the <strong>Open in New Tab</strong> button on the top-right of your screen.</span>
                  </div>
                  <div className="flex gap-1.5">
                    <span className="text-indigo-400 font-extrabold shrink-0">2.</span>
                    <span>Select <strong>Webcam Video & Voice</strong> mode to engage your devices.</span>
                  </div>
                  <div className="flex gap-1.5">
                    <span className="text-indigo-400 font-extrabold shrink-0">3.</span>
                    <span>Already on a separate secure tab? Click <strong>Dismiss Warning</strong> below.</span>
                  </div>
                </div>
                <a
                  href={typeof window !== "undefined" ? window.location.href : "#"}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block text-center w-full bg-linear-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white text-[11px] font-bold py-2.5 px-3 rounded-lg shadow-md transition-all select-none text-decoration-none"
                >
                  Open in a Secure New Tab ↗
                </a>

                <div className="flex flex-col sm:flex-row gap-2 pt-1 border-t border-slate-850/60 mt-1">
                  <button
                    type="button"
                    onClick={() => {
                      console.log("[VideoPlayer] User manually bypassed iframe warning.");
                      setIsInsideIframe(false);
                    }}
                    className="flex-1 text-center bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold py-1.5 px-2 rounded-lg transition-colors cursor-pointer border border-slate-700"
                  >
                    Dismiss Warning
                  </button>
                  {onRetryWebRTC && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsInsideIframe(false);
                        onRetryWebRTC();
                      }}
                      className="flex-1 text-center bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold py-1.5 px-2 rounded-lg shadow-sm transition-colors cursor-pointer"
                    >
                      🔄 Retry Call
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const skipBtn = document.getElementById("chat-panel-skip-btn") || document.getElementById("btn-skip-match");
                      if (skipBtn) {
                        try {
                          (skipBtn as any).click();
                        } catch (e) {
                          console.warn("Could not auto-trigger Skip element action", e);
                        }
                      }
                    }}
                    className="flex-1 text-center bg-slate-800 hover:bg-slate-700 text-slate-400 text-[10px] py-1.5 px-1.5 rounded-lg transition-colors cursor-pointer"
                  >
                    Skip
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3.5 max-w-sm bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-2xl text-left">
                <div className="mx-auto w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                  <AlertCircle className="w-5 h-5 animate-pulse" />
                </div>
                <div className="space-y-1 text-center">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">Connection Delay or Interruption</h4>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    Unable to establish a secure direct peer-to-peer data tunnel with the connected stranger.
                  </p>
                </div>
                <div className="text-[10px] text-slate-350 bg-slate-950/50 p-3 rounded-xl border border-slate-800 space-y-1.5 leading-relaxed">
                  <div className="flex gap-1.5">
                    <span className="text-indigo-400 font-extrabold shrink-0">•</span>
                    <span><strong>Testing alone?</strong> Standard webcams can only stream to one client window at a time. Open an Incognito window or use a different device to test.</span>
                  </div>
                  <div className="flex gap-1.5">
                    <span className="text-indigo-400 font-extrabold shrink-0">•</span>
                    <span>Make sure your webcam/mic is not already active in another app (like Zoom, Teams, Meet) or on another tab of this app.</span>
                  </div>
                  <div className="flex gap-1.5">
                    <span className="text-indigo-400 font-extrabold shrink-0">•</span>
                    <span>Click <strong>Retry Connection</strong> below to force a re-negotiation of peer networks.</span>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  {onRetryWebRTC && (
                    <button
                      type="button"
                      onClick={onRetryWebRTC}
                      className="flex-1 text-center bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-[11px] font-bold py-2 px-3 rounded-lg shadow-md transition-all cursor-pointer"
                    >
                      🔄 Retry Connection
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const skipBtn = document.getElementById("chat-panel-skip-btn") || document.getElementById("btn-skip-match");
                      if (skipBtn) {
                        try {
                          (skipBtn as any).click();
                        } catch (e) {
                          console.warn("Could not auto-trigger Skip element action", e);
                        }
                      }
                    }}
                    className="flex-1 text-center bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold py-2 px-3 rounded-lg shadow-xs transition-colors cursor-pointer border border-slate-700"
                  >
                    Skip & Connect Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Video Overlay Status Tag */}
        <div className="absolute top-2 left-2 sm:top-4 sm:left-4 bg-slate-950/80 backdrop-blur-md border border-slate-800 text-[10px] sm:text-xs px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-slate-200 flex items-center gap-1 sm:gap-1.5 font-medium shadow-xs z-30">
          <span className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${
            webrtcStatus === "connected" || webrtcStatus === "completed" 
              ? "bg-emerald-500 animate-pulse" 
              : webrtcStatus === "checking" || webrtcStatus === "connecting"
                ? "bg-sky-500 animate-spin"
                : "bg-amber-500 animate-pulse"
          }`} />
          Stranger Live {webrtcStatus && webrtcStatus !== "idle" && `(${webrtcStatus})`}
        </div>
      </motion.div>
 
      {/* LOCAL USER VIEW BLOCK */}
      <motion.div 
        layout
        transition={{
          type: "spring",
          stiffness: 450,
          damping: 32,
          mass: 0.6
        }}
        drag={layoutMode === "pip"}
        dragConstraints={containerRef}
        dragElastic={0.12}
        dragMomentum={true}
        onClick={() => setShowLocalControls((prev) => !prev)}
        whileHover={layoutMode === "pip" ? { scale: 1.04 } : {}}
        whileTap={layoutMode === "pip" ? { scale: 0.98, cursor: "grabbing" } : {}}
        className={`group overflow-hidden bg-slate-950 flex items-center justify-center cursor-pointer will-change-transform translate-z-0 ${
          layoutMode === "pip"
            ? "absolute bottom-1.5 right-1.5 w-20 h-28 sm:bottom-4 sm:right-4 sm:w-32 sm:h-44 md:bottom-6 md:right-6 md:w-40 md:h-52 rounded-2xl border border-white/95 shadow-2xl z-30 cursor-grab"
            : "relative w-full h-full min-h-0 rounded-2xl border border-slate-800"
        }`}
      >
        {localStream && cameraActive ? (
          <video
            id="local-video"
            ref={localVideoCallback}
            autoPlay
            playsInline
            muted
            className="w-full h-full bg-slate-950 mirror-mode object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10 text-center p-3 bg-radial from-slate-900 to-slate-950">
            <CameraOff className={`mx-auto text-slate-500 ${layoutMode === "pip" ? "h-4 w-4" : "h-6 w-6 mb-1"}`} />
            <p className={`font-semibold text-slate-400 text-center ${layoutMode === "pip" ? "text-[8px]" : "text-xs"}`}>
              {layoutMode === "pip" ? "Camera Off" : "Self Camera Disabled"}
            </p>
          </div>
        )}

        {/* Your Overlay Tag */}
        <div className={`absolute left-3 bg-slate-950/80 backdrop-blur-md border border-slate-800 text-[10px] px-2 py-0.5 rounded-full text-slate-300 flex items-center gap-1 font-medium shadow-xs z-30 transition-all duration-300 ${
          layoutMode === "pip" ? "top-2" : "top-3"
        } ${
          showLocalControls 
            ? "opacity-95 scale-100" 
            : "opacity-45 md:opacity-25 group-hover:opacity-95 pointer-events-none group-hover:pointer-events-auto scale-95 group-hover:scale-100"
        }`}>
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
          You <span className="hidden sm:inline"> (Self stream)</span>
        </div>

        {/* Media Option Controls Bar - floating inside your window if grid, or bottom HUD in PIP */}
        <div 
          onClick={(e) => e.stopPropagation()}
          className={`absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-slate-950/95 backdrop-blur-lg px-2 py-0.5 rounded-full border border-slate-800 shadow-md z-30 transition-all duration-300 ${
            layoutMode === "pip" ? "scale-85" : "sm:scale-100"
          } ${
            showLocalControls 
              ? "opacity-100 scale-100" 
              : "opacity-0 md:opacity-10 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto scale-90 group-hover:scale-100"
          }`}
        >
          <button
            id="btn-toggle-mic"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleMic();
            }}
            className={`p-1 sm:p-1.5 rounded-full transition-colors cursor-pointer ${
              micActive
                ? "bg-slate-800 hover:bg-slate-700 text-slate-100"
                : "bg-rose-500/25 text-rose-400 border border-rose-500/30 font-medium hover:bg-rose-500/35"
            }`}
            title={micActive ? "Mute Microphone" : "Unmute Microphone"}
          >
            {micActive ? <Mic className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> : <MicOff className="w-3 h-3 sm:w-3.5 sm:h-3.5" />}
          </button>

          <button
            id="btn-toggle-camera"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCamera();
            }}
            className={`p-1 sm:p-1.5 rounded-full transition-colors cursor-pointer ${
              cameraActive
                ? "bg-slate-800 hover:bg-slate-700 text-slate-100"
                : "bg-rose-500/25 text-rose-400 border border-rose-500/30 font-medium hover:bg-rose-500/35"
            }`}
            title={cameraActive ? "Disable Camera" : "Enable Camera"}
          >
            {cameraActive ? <Camera className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> : <CameraOff className="w-3 h-3 sm:w-3.5 sm:h-3.5" />}
          </button>
        </div>
      </motion.div>

      {/* Floating Action: Fullscreen Toggle (Top Right, stacked cleanly below Layout Selector and transparent/half-opacity) */}
      <div className="absolute top-14 right-2 sm:top-[68px] sm:right-3 lg:top-[68px] lg:right-4 z-[45] flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity duration-300">
        <button
          type="button"
          onClick={toggleFullscreen}
          className="flex items-center justify-center bg-slate-950/90 hover:bg-indigo-600 active:scale-95 border border-slate-800 hover:border-indigo-500 rounded-xl p-2 sm:p-2.5 text-slate-300 hover:text-white shadow-2xl transition-all cursor-pointer backdrop-blur-md"
          title={(isFullscreen || isVirtualFullscreen) ? "Exit Fullscreen" : "Enter Fullscreen"}
        >
          {(isFullscreen || isVirtualFullscreen) ? (
            <Minimize2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          ) : (
            <Maximize2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          )}
        </button>
      </div>

      {/* Global CSS for camera mirrors */}
      <style>{`
        .mirror-mode {
          transform: scaleX(-1);
          -webkit-transform: scaleX(-1);
          will-change: transform;
        }
      `}</style>
    </div>
  );
}
