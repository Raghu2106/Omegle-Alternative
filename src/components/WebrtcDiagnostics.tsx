import { useState, useEffect } from "react";
import { Settings, Shield, Server, CheckCircle, Copy, Terminal, ExternalLink, RefreshCw } from "lucide-react";

export interface CustomTurnConfig {
  url: string;
  username?: string;
  credential?: string;
}

interface WebrtcDiagnosticsProps {
  webrtcStatus: string;
}

export default function WebrtcDiagnostics({ webrtcStatus }: WebrtcDiagnosticsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [customConfig, setCustomConfig] = useState<CustomTurnConfig>({
    url: "",
    username: "",
    credential: "",
  });
  const [savedConfig, setSavedConfig] = useState<CustomTurnConfig | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("umegle_custom_ice_config");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setCustomConfig(parsed);
        setSavedConfig(parsed);
      } catch (err) {
        console.error("Failed to parse custom ICE config", err);
      }
    }
  }, []);

  const handleSave = () => {
    if (!customConfig.url.trim()) {
      localStorage.removeItem("umegle_custom_ice_config");
      setSavedConfig(null);
      alert("Custom config cleared. Utilizing standard open-source relays.");
      return;
    }
    localStorage.setItem("umegle_custom_ice_config", JSON.stringify(customConfig));
    setSavedConfig(customConfig);
    alert("Coturn server configurations saved successfully! Any future chat sessions will route via your self-hosted node.");
  };

  const handleClear = () => {
    localStorage.removeItem("umegle_custom_ice_config");
    setCustomConfig({ url: "", username: "", credential: "" });
    setSavedConfig(null);
    alert("Restored to standard open-source relays.");
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const activeStatusColor = () => {
    switch (webrtcStatus.toLowerCase()) {
      case "connected":
      case "completed":
        return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
      case "checking":
      case "connecting":
        return "text-amber-400 bg-amber-500/10 border-amber-500/20 animate-pulse";
      case "failed":
        return "text-rose-400 bg-rose-500/10 border-rose-500/20";
      default:
        return "text-slate-400 bg-slate-500/10 border-slate-500/20";
    }
  };

  const dockerCommand = `# Spin up your ultra-fast Coturn STUN/TURN server via Docker with 1 command:
docker run -d --name coturn-server --net=host \\
  -v /etc/coturn/turnserver.conf:/etc/coturn/turnserver.conf \\
  coturn/coturn:latest \\
  -v --lt-cred-mech --fingerprint --realm=umegle.local \\
  --user=admin:securepassword123 --listening-port=3478 \\
  --tls-listening-port=53478 --min-port=49152 --max-port=65535`;

  const rawConfigSample = `listening-port=3478
tls-listening-port=53478
fingerprint
lt-cred-mech
user=admin:securepassword123
realm=yourdomain.com
verbose`;

  return (
    <div className="z-40">
      {/* Control Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-violet-300 bg-violet-950/70 border border-violet-800/60 hover:bg-violet-900/40 hover:text-white transition-all cursor-pointer shadow-xs active:scale-95"
        title="P2P Server and Coturn settings"
      >
        <Settings className="w-3.5 h-3.5 animate-spin-slow" />
        <span>P2P Diagnostics</span>
      </button>

      {/* Slide-out Panel Overlay */}
      {isOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div 
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col relative text-left"
            id="diag-modal-content"
          >
            {/* Modal Header */}
            <div className="p-5 border-b border-light-slate bg-linear-to-r from-violet-950 to-slate-900 rounded-t-2xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-violet-500/15 border border-violet-500/30 rounded-lg flex items-center justify-center text-violet-400 text-lg">
                  <Server className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-100 text-base tracking-tight">P2P Connection Settings</h3>
                  <p className="text-xs text-slate-400 font-medium">Configure high-availability Open-Source Coturn nodes</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-705 p-1.5 rounded-lg text-sm font-bold transition-all cursor-pointer active:scale-90"
              >
                ✕
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-6">
              {/* Connection Status Panel */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">WebRTC Peer Connection state</h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">Real-time status of current anonymous video/voice audio pipeline.</p>
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest border ${activeStatusColor()}`}>
                  {webrtcStatus || "idle"}
                </div>
              </div>

              {/* Explain OpenSource Coturn hosting */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                  <Shield className="w-4.5 h-4.5 text-indigo-400" />
                  <h4 className="text-sm font-extrabold text-slate-200">Self-Hosting Free & Secure Coturn Server</h4>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  WebRTC requires fallback <strong>TURN (Traversal Using Relays around NAT)</strong> servers when firewalls block direct connection. 
                  Hosting your own open-source <strong>Coturn</strong> server is the industry standard—giving you 100% video stream stability.
                </p>

                {/* Open-Source Instructions */}
                <div className="bg-slate-950 rounded-xl overflow-hidden border border-slate-800">
                  <div className="bg-slate-900 border-b border-slate-850 px-4 py-2 flex justify-between items-center text-xs text-slate-400 font-bold font-mono">
                    <span className="flex items-center gap-1.5 text-indigo-300">
                      <Terminal className="w-3.5 h-3.5" /> Docker command
                    </span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(dockerCommand, 0)}
                      className="hover:text-white transition-colors cursor-pointer flex items-center gap-1"
                    >
                      {copiedIndex === 0 ? <CheckCircle className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      {copiedIndex === 0 ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <pre className="p-3 text-[10px] sm:text-[11px] font-mono text-indigo-200 overflow-x-auto whitespace-pre leading-5">
                    {dockerCommand}
                  </pre>
                </div>

                <div className="text-xs text-slate-500 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  <span>
                    Deploy on free cloud VMs (AWS Elastic Cloud Free Tier or Oracle Cloud Infrastructure Free) for permanent zero-cost utility.
                  </span>
                </div>
              </div>

              {/* Live configuration settings form */}
              <div className="space-y-4 border-t border-slate-800 pt-5">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-extrabold text-slate-200 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    <span>Apply Custom Coturn Server settings</span>
                  </h4>
                  {savedConfig && (
                    <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2.5 py-0.5 rounded-full font-bold">
                      Active
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-wider">TURN / STUN URI</label>
                    <input
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 focus:border-violet-500/70 rounded-lg p-2 text-xs text-slate-200 outline-none"
                      placeholder="e.g. turn:yourdomain.com:3478"
                      value={customConfig.url}
                      onChange={(e) => setCustomConfig({ ...customConfig, url: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-wider">Username (Optional)</label>
                    <input
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 focus:border-violet-500/70 rounded-lg p-2 text-xs text-slate-200 outline-none"
                      placeholder="e.g. admin"
                      value={customConfig.username}
                      onChange={(e) => setCustomConfig({ ...customConfig, username: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-wider font-bold">Credential / Password</label>
                    <input
                      type="password"
                      className="w-full bg-slate-950 border border-slate-800 focus:border-violet-500/70 rounded-lg p-2 text-xs text-slate-200 outline-none"
                      placeholder="e.g. securepassword123"
                      value={customConfig.credential}
                      onChange={(e) => setCustomConfig({ ...customConfig, credential: e.target.value })}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={handleSave}
                    className="bg-violet-600 hover:bg-violet-505 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm active:scale-95"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>Apply Settings</span>
                  </button>
                  {savedConfig && (
                    <button
                      type="button"
                      onClick={handleClear}
                      className="bg-slate-800 hover:bg-slate-705 text-slate-400 text-xs font-medium px-3 py-2 rounded-lg transition-colors cursor-pointer"
                    >
                      Clear & Use Default Relay
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-slate-800 bg-slate-950/50 rounded-b-2xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
              <span className="flex items-center gap-1 text-[11px]">
                <Shield className="w-3.5 h-3.5 text-emerald-400" /> WebRTC traffic remains fully encrypted e2e.
              </span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="bg-slate-800 hover:bg-slate-705 text-slate-200 font-bold px-4 py-2 rounded-lg transition-colors cursor-pointer w-full sm:w-auto text-center"
              >
                Close Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
