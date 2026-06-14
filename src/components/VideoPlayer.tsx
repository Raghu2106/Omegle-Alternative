import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Camera, CameraOff, Mic, MicOff, Users, Sparkles, Grid, Layers, Monitor, Maximize2, Minimize2 } from "lucide-react";

interface VideoPlayerProps {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isSearching: boolean;
  isPaired: boolean;
  cameraActive: boolean;
  micActive: boolean;
  onToggleCamera: () => void;
  onToggleMic: () => void;
  mode: "text" | "video";
}

export default function VideoPlayer({
  localStream,
  remoteStream,
  isSearching,
  isPaired,
  cameraActive,
  micActive,
  onToggleCamera,
  onToggleMic,
  mode,
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
  const [showLocalControls, setShowLocalControls] = useState(false);

  const handleRecoverAutoplay = () => {
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

  // Automatically start with PiP mode on mobile and tablet screens for optimal visual space
  useEffect(() => {
    const handleResize = () => {
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        setLayoutMode("pip");
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Keep references updated
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, layoutMode, cameraActive]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play()
        .then(() => {
          setAutoplayBlocked(false);
        })
        .catch((err) => {
          console.warn("[VideoPlayer] Autoplay was blocked/halted by browser:", err);
          setAutoplayBlocked(true);
        });
    } else {
      setAutoplayBlocked(false);
    }
  }, [remoteStream, layoutMode, isPaired]);

  // Proactively listen for any document interaction to recover from autoplay blockages
  useEffect(() => {
    if (!autoplayBlocked || !remoteStream) return;

    const tryPlay = () => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.play()
          .then(() => {
            console.log("[VideoPlayer] Autoplay successfully recovered via user interaction.");
            setAutoplayBlocked(false);
          })
          .catch((err) => {
            console.warn("[VideoPlayer] User interaction play recovery attempt failed:", err);
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
      
      {/* Floating Layout Selector HUD Tag */}
      <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-40 bg-slate-950/90 backdrop-blur-md border border-slate-800 rounded-xl p-0.5 sm:p-1 hidden lg:flex items-center gap-0.5 sm:gap-1 shadow-xl">
        <button
          type="button"
          onClick={() => setLayoutMode("grid")}
          className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-all cursor-pointer ${
            layoutMode === "grid"
              ? "bg-indigo-600 text-white"
              : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
          }`}
          title="Equal Split (Up and Down)"
        >
          <Layers className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Up and Down</span>
        </button>
        <button
          type="button"
          onClick={() => setLayoutMode("enlarged")}
          className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-all cursor-pointer ${
            layoutMode === "enlarged"
              ? "bg-indigo-600 text-white"
              : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
          }`}
          title="Side-by-Side View"
        >
          <Grid className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Side-by-Side</span>
        </button>
        <button
          type="button"
          onClick={() => setLayoutMode("pip")}
          className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-all cursor-pointer ${
            layoutMode === "pip"
              ? "bg-indigo-600 text-white"
              : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
          }`}
          title="Overlay (PIP)"
        >
          <Monitor className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Overlay (PIP)</span>
        </button>
      </div>

      {/* STRANGER VIEW BLOCK */}
      <div 
        className="relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center transition-all w-full h-full min-h-0"
      >
        {isPaired && remoteStream ? (
          <video
            id="remote-video"
            ref={(el) => {
              remoteVideoRef.current = el;
              if (el && el.srcObject !== remoteStream) {
                el.srcObject = remoteStream;
              }
            }}
            autoPlay
            playsInline
            className="w-full h-full object-contain bg-slate-950"
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

        {/* Autoplay blocked recovery overlay */}
        {isPaired && remoteStream && autoplayBlocked && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-md z-30 p-6 text-center">
            <div className="space-y-4 max-w-xs bg-slate-900/90 p-6 rounded-2xl border border-slate-800 shadow-2xl">
              <div className="mx-auto w-10 h-10 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                <Mic className="w-5 h-5 animate-pulse" />
              </div>
              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-white">Unmute stranger stream</h4>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Web browsers in iframe sandboxes require a user interaction to connect sound or video. Tap below to connect fully!
                </p>
              </div>
              <button
                type="button"
                onClick={handleRecoverAutoplay}
                className="w-full bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-[11px] font-bold py-2 px-3 rounded-lg shadow-md transition-all cursor-pointer"
              >
                Connect Voice & Video
              </button>
            </div>
          </div>
        )}

        {/* Video Overlay Status Tag */}
        <div className="absolute top-2 left-2 sm:top-4 sm:left-4 bg-slate-950/80 backdrop-blur-md border border-slate-800 text-[10px] sm:text-xs px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-slate-200 flex items-center gap-1 sm:gap-1.5 font-medium shadow-xs z-30">
          <span className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${isPaired ? "bg-emerald-500 animate-pulse" : "bg-amber-500 animate-pulse"}`} />
          Stranger Live
        </div>
      </div>

      {/* LOCAL USER VIEW BLOCK */}
      <motion.div 
        key={layoutMode}
        drag={layoutMode === "pip"}
        dragConstraints={containerRef}
        dragElastic={0.05}
        dragMomentum={false}
        onClick={() => setShowLocalControls((prev) => !prev)}
        whileHover={layoutMode === "pip" ? { scale: 1.05 } : {}}
        whileTap={layoutMode === "pip" ? { scale: 1.02, cursor: "grabbing" } : {}}
        className={`group overflow-hidden bg-slate-950 flex items-center justify-center cursor-pointer transition-all ${
          layoutMode === "pip"
            ? "absolute bottom-1.5 right-1.5 w-20 h-28 sm:bottom-4 sm:right-4 sm:w-32 sm:h-44 md:bottom-6 md:right-6 md:w-40 md:h-52 rounded-2xl border border-white/95 shadow-2xl z-30 cursor-grab"
            : "relative w-full h-full min-h-0 rounded-2xl border border-slate-800"
        }`}
      >
        {localStream && cameraActive ? (
          <video
            id="local-video"
            ref={(el) => {
              localVideoRef.current = el;
              if (el && el.srcObject !== localStream) {
                el.srcObject = localStream;
              }
            }}
            autoPlay
            playsInline
            muted
            className={`w-full h-full bg-slate-950 mirror-mode ${
              layoutMode === "pip" ? "object-cover" : "object-contain"
            }`}
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

      {/* Floating Action: Fullscreen Toggle (Bottom Right) */}
      <div className="absolute bottom-4 right-4 z-[45] flex items-center justify-center">
        <button
          type="button"
          onClick={toggleFullscreen}
          className="flex items-center justify-center bg-slate-950/90 hover:bg-indigo-600 active:scale-95 border border-slate-800 hover:border-indigo-500 rounded-xl p-2.5 text-slate-300 hover:text-white shadow-2xl transition-all cursor-pointer backdrop-blur-md"
          title={(isFullscreen || isVirtualFullscreen) ? "Exit Fullscreen" : "Enter Fullscreen"}
        >
          {(isFullscreen || isVirtualFullscreen) ? (
            <Minimize2 className="w-4 h-4" />
          ) : (
            <Maximize2 className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Global CSS for camera mirrors */}
      <style>{`
        .mirror-mode {
          transform: rotateY(180deg);
          -webkit-transform: rotateY(180deg);
        }
      `}</style>
    </div>
  );
}
