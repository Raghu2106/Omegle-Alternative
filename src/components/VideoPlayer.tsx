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
  mode: "text" | "voice" | "video";
  webrtcStatus?: string;
  onRetryWebRTC?: () => void;
  remoteVideoFrame?: string | null;
  rtcEngine?: "p2p" | "jitsi";
  onToggleRtcEngine?: (newEngine: "p2p" | "jitsi") => void;
  roomId?: string;
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
  rtcEngine = "p2p",
  onToggleRtcEngine,
  roomId = "",
}: VideoPlayerProps) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  const localVideoCallback = useCallback((el: HTMLVideoElement | null) => {
    localVideoRef.current = el;
    if (el && localStream) {
      el.muted = true; // FORCE MUTED TO PREVENT ACOUSTIC FEEDBACK ECHO
      const videoTracks = localStream.getVideoTracks();
      if (videoTracks.length > 0) {
        const currentSrcObject = el.srcObject as MediaStream | null;
        const alreadyBound = currentSrcObject && 
                             currentSrcObject.getVideoTracks().length > 0 && 
                             currentSrcObject.getVideoTracks()[0].id === videoTracks[0].id;
        if (!alreadyBound) {
          console.log("[VideoPlayer] Binding videoOnlyStream to local video element via callback ref to eliminate feedback loops");
          el.srcObject = new MediaStream(videoTracks);
        }
      } else {
        el.srcObject = null;
      }
      el.play().catch((err) => {
        console.warn("[VideoPlayer] Local video play failed in callback ref: ", err);
      });
    }
  }, [localStream]);

  const remoteVideoCallback = useCallback((el: HTMLVideoElement | null) => {
    remoteVideoRef.current = el;
    if (el && remoteStream) {
      el.muted = true; // FORCE MUTED TO ELIMINATE DUPLICATE AUDIO PLAYBACK PATHS
      if (el.srcObject !== remoteStream) {
        console.log("[VideoPlayer] Binding remoteStream to video element via callback ref (Muted)");
        el.srcObject = remoteStream;
      }
      el.play()
        .then(() => {
          setAutoplayBlocked(false);
        })
        .catch((err) => {
          console.warn("[VideoPlayer] Local muted video play failed inside callback ref: ", err);
        });
    }
  }, [remoteStream]);

  const jitsiUrl = roomId 
    ? `https://meet.jit.si/${roomId}#config.prejoinPageEnabled=false&config.startWithAudioMuted=${!micActive}&config.startWithVideoMuted=${!cameraActive}&interfaceConfig.TOOLBAR_BUTTONS=[]&interfaceConfig.SETTINGS_SECTIONS=[]&config.disableDeepLinking=true&config.hideConferenceTimer=true&config.chromeExtensionBanner.prevent=true&interfaceConfig.SHOW_JITSI_WATERMARK=false&interfaceConfig.SHOW_BRAND_WATERMARK=false&interfaceConfig.SHOW_POWERED_BY=false&interfaceConfig.GENERATE_ROOMNAMES_ON_WELCOME_PAGE=false`
    : "";

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
    const el = localVideoRef.current;
    if (el && localStream) {
      el.muted = true; // FORCE MUTED TO PREVENT ACOUSTIC FEEDBACK ECHO
      const videoTracks = localStream.getVideoTracks();
      if (videoTracks.length > 0) {
        const currentSrcObject = el.srcObject as MediaStream | null;
        const alreadyBound = currentSrcObject && 
                             currentSrcObject.getVideoTracks().length > 0 && 
                             currentSrcObject.getVideoTracks()[0].id === videoTracks[0].id;
        if (!alreadyBound) {
          console.log("[VideoPlayer] Binding videoOnlyStream to local video element via useEffect to eliminate feedback loops");
          el.srcObject = new MediaStream(videoTracks);
        }
      } else {
        el.srcObject = null;
      }
      el.play().catch((err) => {
        console.warn("[VideoPlayer] Local video play failed: ", err);
      });
    }
  }, [localStream, layoutMode, cameraActive]);

  useEffect(() => {
    const el = remoteVideoRef.current;
    if (el && remoteStream) {
      el.muted = true; // FORCE MUTED TO ELIMINATE DUPLICATE AUDIO PLAYBACK PATHS
      if (el.srcObject !== remoteStream) {
        console.log("[VideoPlayer] Binding remoteStream to video element via useEffect (Muted)");
        el.srcObject = remoteStream;
      }
      el.play()
        .then(() => {
          setAutoplayBlocked(false);
        })
        .catch((err) => {
          console.warn("[VideoPlayer] Local muted video play failed inside useEffect: ", err);
        });
    } else {
      setAutoplayBlocked(false);
    }
  }, [remoteStream, remoteStreamVersion, layoutMode, isPaired]);

  const getWebrtcStatusLabel = () => {
    if (!webrtcStatus || webrtcStatus === "idle") return "";
    if (webrtcStatus === "connected" || webrtcStatus === "completed") {
      return " (connected)";
    }
    if (webrtcStatus === "checking" || webrtcStatus === "connecting") {
      return " (connecting...)";
    }
    if (webrtcStatus === "failed" || webrtcStatus === "disconnected" || webrtcStatus === "closed") {
      // Seamless custom socket relay fallback is running
      return " (connected)";
    }
    return " (connected)";
  };

  const getWebrtcStatusColorClass = () => {
    if (webrtcStatus === "connected" || webrtcStatus === "completed" || webrtcStatus === "failed" || webrtcStatus === "disconnected" || webrtcStatus === "closed") {
      return "bg-emerald-500 animate-pulse";
    }
    if (webrtcStatus === "checking" || webrtcStatus === "connecting") {
      return "bg-sky-500 animate-pulse";
    }
    return "bg-amber-500 animate-pulse";
  };

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

  if (mode === "voice") {
    return (
      <div className="flex flex-row items-center justify-between h-full w-full bg-gradient-to-r from-violet-950 via-slate-900 to-indigo-950 px-3 sm:px-6 py-2 text-center border-b border-violet-900/40 select-none overflow-hidden relative">
        {/* Subtle decorative glow */}
        <div className="absolute -left-10 top-1/2 -translate-y-1/2 w-48 h-48 bg-violet-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -right-10 top-1/2 -translate-y-1/2 w-48 h-48 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none" />

        {/* Left Section: Voice channel status */}
        <div className="flex flex-col items-start gap-1 z-10 max-w-[140px] xs:max-w-xs md:max-w-sm text-left shrink-0">
          <div className="bg-violet-900/40 border border-violet-500/30 text-[10px] sm:text-[11px] px-2 py-0.5 sm:py-1 rounded-full text-violet-200 flex items-center gap-1.5 font-bold shadow-xs">
            <span className={`w-1.5 h-1.5 rounded-full min-w-[6px] shrink-0 ${getWebrtcStatusColorClass()}`} />
            <span className="truncate">Voice Mode{getWebrtcStatusLabel()}</span>
          </div>
          
          <div className="hidden xs:block text-[10px] text-violet-300 font-medium truncate max-w-[150px] sm:max-w-[200px]">
            {isSearching ? (
              <span className="text-violet-400 font-medium animate-pulse">Scanning pool...</span>
            ) : isPaired ? (
              <span className="text-emerald-400 font-semibold flex items-center gap-1">Stranger active</span>
            ) : (
              <span className="text-violet-400/70">Idle</span>
            )}
          </div>
        </div>

        {/* Center Section: Compact Horizontal Pairing Flow */}
        <div className="flex-grow flex items-center justify-center gap-2 sm:gap-4 z-10 px-2 min-w-0">
          {/* YOU user status */}
          <div className="relative shrink-0">
            <div className={`absolute -inset-1.5 rounded-full bg-violet-500/25 blur-xs ${micActive && isPaired ? "animate-pulse" : ""}`} />
            <div 
              className={`relative w-8 h-8 sm:w-10 sm:h-10 rounded-full border flex items-center justify-center flex-col transition-all overflow-hidden ${
                micActive 
                  ? "bg-violet-600/20 border-violet-500/40 text-violet-300 shadow-xs shadow-violet-500/20" 
                  : "bg-slate-900 border-slate-800 text-slate-500"
              }`}
            >
              {micActive ? (
                <Mic className="w-3.5 h-3.5 sm:w-4.5 sm:h-4.5 animate-pulse" />
              ) : (
                <MicOff className="w-3.5 h-3.5 sm:w-4.5 sm:h-4.5" />
              )}
            </div>
          </div>

          {/* Sound Wave Indicator */}
          <div className="flex items-center justify-center h-6 w-10 sm:w-14 relative shrink-0">
            {isPaired ? (
              <div className="flex items-end justify-center gap-[3px] h-4 w-full">
                {[0.4, 0.9, 0.5, 0.7, 0.3].map((offset, idx) => (
                  <motion.div
                    key={idx}
                    animate={{
                      height: micActive ? ["3px", "14px", "3px"] : "3px"
                    }}
                    transition={{
                      repeat: Infinity,
                      duration: 0.7 / offset,
                      ease: "easeInOut",
                      delay: idx * 0.08
                    }}
                    className="w-[3px] rounded-full bg-gradient-to-t from-violet-500 to-indigo-400"
                  />
                ))}
              </div>
            ) : (
              <motion.div
                animate={{
                  translateX: ["-10px", "10px", "-10px"]
                }}
                transition={{
                  repeat: Infinity,
                  duration: 1.4,
                  ease: "easeInOut"
                }}
                className="w-1.5 h-1.5 rounded-full bg-violet-400 shadow-[0_0_6px_#a78bfa]"
              />
            )}
          </div>

          {/* STRANGER status */}
          <div className="relative shrink-0">
            <div className={`absolute -inset-1.5 rounded-full bg-sky-500/20 blur-xs ${isPaired ? "animate-pulse" : ""}`} />
            <div 
              className={`relative w-8 h-8 sm:w-10 sm:h-10 rounded-full border flex items-center justify-center flex-col transition-all overflow-hidden ${
                isPaired 
                  ? "bg-sky-500/20 border-sky-500/40 text-sky-400 shadow-xs shadow-sky-500/15" 
                  : "bg-slate-900 border-slate-800 text-slate-500"
              }`}
            >
              <Users className="w-3.5 h-3.5 sm:w-4.5 sm:h-4.5" />
            </div>
          </div>
        </div>

        {/* Right Section: Microphone & Connection Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 z-10 shrink-0">
          {isPaired && (
            <button
              type="button"
              onClick={() => onToggleRtcEngine?.(rtcEngine === "p2p" ? "jitsi" : "p2p")}
              className={`p-1.5 sm:p-2 px-2.5 sm:px-3 rounded-lg sm:rounded-xl transition-all cursor-pointer font-bold text-[10px] sm:text-xs flex items-center gap-1 sm:gap-1.5 border ${
                rtcEngine === "jitsi"
                  ? "bg-gradient-to-r from-violet-600 to-indigo-650 border-violet-400 text-white shadow-md shadow-violet-900/35"
                  : "bg-slate-800 hover:bg-slate-750 border-slate-700 text-slate-300 active:scale-95"
              }`}
              title={rtcEngine === "jitsi" ? "Switch back to standard P2P direct" : "Switch to secure server routing (Safe Relay)"}
            >
              <Sparkles className={`w-3.5 h-3.5 ${rtcEngine === "jitsi" ? "text-amber-400 animate-pulse" : "text-violet-400"}`} />
              <span>{rtcEngine === "jitsi" ? "Relay Active" : "Use Relay"}</span>
            </button>
          )}

          <button
            id="bg-btn-voice-toggle-mic"
            type="button"
            onClick={onToggleMic}
            className={`p-1.5 sm:p-2 px-2.5 sm:px-3 rounded-lg sm:rounded-xl transition-all cursor-pointer font-bold text-[10px] sm:text-xs flex items-center gap-1 sm:gap-1.5 border ${
              micActive
                ? "bg-gradient-to-r from-violet-600 via-indigo-600 to-indigo-700 hover:scale-[1.03] active:scale-95 border-violet-400 text-white shadow-md shadow-violet-900/30"
                : "bg-rose-500/20 hover:bg-rose-500/30 border-rose-500/30 text-rose-300 active:scale-95"
            }`}
            title={micActive ? "Mute Microphone" : "Unmute Microphone"}
          >
            {micActive ? (
              <>
                <Mic className="w-3.5 h-3.5" />
                <span className="hidden xs:inline">Mute</span>
              </>
            ) : (
              <>
                <MicOff className="w-3.5 h-3.5" />
                <span className="hidden xs:inline font-black text-rose-200">Unmute</span>
              </>
            )}
          </button>
          
          {onRetryWebRTC && (webrtcStatus === "failed" || webrtcStatus === "disconnected") && rtcEngine !== "jitsi" && (
            <button
              type="button"
              onClick={onRetryWebRTC}
              className="bg-violet-900/40 hover:bg-violet-850/60 border border-violet-700/50 text-violet-200 font-bold px-2 py-1.5 rounded-lg sm:rounded-xl text-[10px] sm:text-xs transition-all cursor-pointer active:scale-95 shrink-0"
            >
              Retry P2P
            </button>
          )}
        </div>
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

      {/* Floating Connection Engine Toggler (Top Left, balancing out Layout Toggler) */}
      {isPaired && (
        <div className="absolute top-2 left-2 sm:top-3 sm:left-3 z-40 bg-slate-950/90 backdrop-blur-md border border-slate-800 rounded-xl p-0.5 flex items-center gap-0.5 shadow-xl">
          <button
            type="button"
            onClick={() => onToggleRtcEngine?.("p2p")}
            className={`flex items-center gap-1.5 text-[10px] sm:text-[11px] font-bold px-1.5 py-1 sm:px-2 sm:py-1 rounded-lg transition-all cursor-pointer ${
              rtcEngine === "p2p"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/20"
                : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
            }`}
            title="Direct P2P (Lowest Latency)"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>P2P Direct</span>
          </button>
          <button
            type="button"
            onClick={() => onToggleRtcEngine?.("jitsi")}
            className={`flex items-center gap-1.5 text-[10px] sm:text-[11px] font-bold px-1.5 py-1 sm:px-2 sm:py-1 rounded-lg transition-all cursor-pointer ${
              rtcEngine === "jitsi"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/20"
                : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
            }`}
            title="Secure Server Routing (High Reliability)"
          >
            <Sparkles className="w-3 text-amber-400 animate-pulse animate-duration-1000" />
            <span>Relay Mode</span>
          </button>
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
        {isPaired && rtcEngine === "jitsi" ? (
          <iframe
            src={jitsiUrl}
            allow="camera; microphone; fullscreen; display-capture; autoplay"
            className="w-full h-full border-none bg-slate-950 rounded-2xl z-20"
            title="Secure High Reliability Relay Room Feed"
          />
        ) : isPaired && remoteStream ? (
          <video
            id="remote-video"
            ref={remoteVideoCallback}
            autoPlay
            playsInline
            muted={true}
            className="w-full h-full object-cover bg-slate-950"
          />
        ) : isPaired && remoteVideoFrame ? (
          <img
            src={remoteVideoFrame}
            className="w-full h-full object-cover bg-slate-950 select-none pointer-events-none"
            alt="Remote Stranger Feed"
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



        {/* Video Overlay Status Tag */}
        <div className="absolute top-2 left-2 sm:top-4 sm:left-4 bg-slate-950/80 backdrop-blur-md border border-slate-800 text-[10px] sm:text-xs px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-slate-200 flex items-center gap-1 sm:gap-1.5 font-medium shadow-xs z-30 font-sans">
          <span className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${
            rtcEngine === "jitsi" ? "bg-indigo-400 animate-pulse" : getWebrtcStatusColorClass()
          }`} />
          {rtcEngine === "jitsi" ? "Stranger Live (Relay Active)" : `Stranger Live${getWebrtcStatusLabel()}`}
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
        {localStream && cameraActive && rtcEngine !== "jitsi" ? (
          <video
            id="local-video"
            ref={localVideoCallback}
            autoPlay
            playsInline
            muted={true}
            className="w-full h-full bg-slate-950 mirror-mode object-cover"
          />
        ) : rtcEngine === "jitsi" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10 text-center p-3 bg-indigo-950/20">
            <Sparkles className={`mx-auto text-indigo-400 animate-pulse ${layoutMode === "pip" ? "h-4 w-4" : "h-6 w-6 mb-1"}`} />
            <p className={`font-semibold text-indigo-300 text-center uppercase tracking-wider ${layoutMode === "pip" ? "text-[8px]" : "text-[10px]"}`}>
              Relay Active
            </p>
          </div>
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
