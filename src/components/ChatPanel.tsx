import React, { useState, useEffect, useRef } from "react";
import { Send, Hand, HelpCircle, X, Shield, Sparkles, RefreshCw, Settings, Pause, Play } from "lucide-react";
import { Message } from "../types";
import AdContainer from "./AdContainer";

interface ChatPanelProps {
  messages: Message[];
  isSearching: boolean;
  isPaired: boolean;
  commonInterests: string[];
  strangerIsTyping: boolean;
  onSendMessage: (text: string) => void;
  onSkip: () => void;
  onStop: () => void;
  onTyping: (isTyping: boolean) => void;
  interests: string[];
  onAddInterest: (tag: string) => void;
  onRemoveInterest: (tag: string) => void;
  autoConnect: boolean;
  onToggleAutoConnect: () => void;
  onPause: () => void;
}

const POPULAR_SUGGESTIONS = [
  "gaming", "music", "coding", "movies", "anime", "books", "art", "sports", "tech", "singing"
];

export default function ChatPanel({
  messages,
  isSearching,
  isPaired,
  commonInterests,
  strangerIsTyping,
  onSendMessage,
  onSkip,
  onStop,
  onTyping,
  interests,
  onAddInterest,
  onRemoveInterest,
  autoConnect,
  onToggleAutoConnect,
  onPause,
}: ChatPanelProps) {
  const [inputText, setInputText] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  const [showInterestsEditor, setShowInterestsEditor] = useState(false);
  const [localInterestInput, setLocalInterestInput] = useState("");
  
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-scroll logic when messages update
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [messages, strangerIsTyping]);

  // Support ESC shortcut just like legendary Omegle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        triggerSkipAction();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPaired, isSearching, confirmStop]);

  // Handle input text changes
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);

    // Notify partner client is typing
    if (isPaired) {
      onTyping(true);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      
      typingTimeoutRef.current = setTimeout(() => {
        onTyping(false);
      }, 2000);
    }
  };

  // Submit typed message
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    onSendMessage(inputText.trim());
    setInputText("");
    onTyping(false);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
  };

  // Skip or Stop Action sequence
  const triggerSkipAction = () => {
    if (isSearching) {
      // "Stop" while searching should pause the search
      onPause();
    } else if (isPaired) {
      if (!confirmStop) {
        setConfirmStop(true);
      } else {
        setConfirmStop(false);
        onSkip();
      }
    } else {
      onSkip();
    }
  };

  // Cancel skip confirmation when typing or clicking elsewhere
  useEffect(() => {
    if (inputText.trim()) {
      setConfirmStop(false);
    }
  }, [inputText]);

  // Reset confirmation state when matching statuses change or user leaves
  useEffect(() => {
    setConfirmStop(false);
  }, [isPaired, isSearching]);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-[#fcfdfd]" id="widget-chat-panel">
      
      {/* Upper header with Match Details & Auto-connect / Pause options */}
      <div className="flex flex-row items-center justify-between px-2.5 py-2 sm:px-4 sm:py-3 border-b border-slate-100 bg-white gap-2 shadow-2xs shrink-0 select-none">
        
        {/* Connection status container */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <div className={`w-1.5 h-1.5 sm:w-2 sm:h-2.5 rounded-full ${
            isPaired 
              ? "bg-emerald-500 animate-pulse" 
              : isSearching 
                ? "bg-indigo-500 animate-pulse" 
                : "bg-amber-400"
          }`} />
          <h2 className="text-[9px] sm:text-[10px] lg:text-xs font-bold uppercase tracking-wider text-slate-800">
            {isPaired ? (
              <>
                <span className="lg:hidden">Stranger</span>
                <span className="hidden lg:inline">Talking to stranger</span>
              </>
            ) : isSearching ? (
              <>
                <span className="lg:hidden">Matching...</span>
                <span className="hidden lg:inline">Matching pool...</span>
              </>
            ) : (
              <>
                <span className="lg:hidden">Paused</span>
                <span className="hidden lg:inline">Match Lobby Paused</span>
              </>
            )}
          </h2>
        </div>
        
        {/* Interests Overlay if matched - show on tablets/desktops */}
        {isPaired && commonInterests.length > 0 && (
          <div className="hidden lg:flex items-center gap-1.5 bg-indigo-50 border border-indigo-100/50 px-2 py-0.5 rounded-md text-[10px] text-indigo-700">
            <Sparkles className="w-3 h-3 text-indigo-500" />
            <span className="font-semibold">Tags:</span>
            <span className="font-medium truncate max-w-[120px]">{commonInterests.join(", ")}</span>
          </div>
        )}

        {/* Global toggles and back to dashboard option */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          
          {/* Unsolicited auto load pause toggle */}
          <label className="flex items-center gap-1 bg-slate-50 border border-slate-200/70 px-1 py-0.5 sm:px-2 sm:py-1 rounded-md sm:rounded-lg select-none cursor-pointer hover:bg-slate-100 transition-colors">
            <input
              type="checkbox"
              checked={autoConnect}
              onChange={onToggleAutoConnect}
              className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 transition-colors cursor-pointer"
            />
            <span className="text-[8px] sm:text-[9px] lg:text-[10px] font-bold text-slate-600 uppercase tracking-widest leading-none">
              <span className="lg:hidden">Auto</span>
              <span className="hidden lg:inline">Auto-Connect Next</span>
            </span>
          </label>

          <button
            id="btn-exit-lobby"
            type="button"
            onClick={onStop}
            className="text-[8px] sm:text-[9px] lg:text-[10px] font-extrabold text-rose-600 hover:text-white hover:bg-rose-600 px-1.5 py-1 sm:px-2 sm:py-1.5 rounded-md sm:rounded-lg border border-rose-200 hover:border-rose-600 transition-all uppercase tracking-wider bg-transparent shrink-0"
          >
            <span className="lg:hidden">Exit</span>
            <span className="hidden lg:inline">Exit to Home</span>
          </button>
        </div>
      </div>

      {/* Main Messages Container */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-3 sm:px-5 sm:py-6 space-y-3 sm:space-y-4 scrollbar-thin scrollbar-thumb-slate-200 bg-[#fcfdfd]"
      >
        {/* Dynamic Pause / Lobby Manager Panel */}
        {!isSearching && !isPaired && (
          <div className="mb-4 p-4 rounded-xl bg-amber-50/55 border border-amber-200/60 shadow-3xs text-left animate-fadeIn">
            <div className="flex items-center gap-1.5 text-amber-850 text-amber-900 font-bold text-xs uppercase tracking-wider mb-1">
              <Pause className="w-3.5 h-3.5 text-amber-600" />
              Connection Paused
            </div>
            <p className="text-[11px] text-slate-600 leading-normal mb-3">
              We stopped matching so you could breathe and update your criteria. Resume matching anytime using the controls below.
            </p>
            
            {/* Interests Editor Toggle & Controls */}
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowInterestsEditor(!showInterestsEditor)}
                  className="flex-1 py-2 px-3 border border-slate-200 hover:bg-slate-50 bg-white text-slate-700 rounded-lg text-[10px] font-extrabold tracking-wider uppercase transition-all shadow-3xs flex items-center justify-center gap-1.5"
                >
                  <Settings className="w-3.5 h-3.5 text-slate-400" />
                  {showInterestsEditor ? "Close Interests Editor" : "Update Interests Here"}
                </button>
                <button
                  type="button"
                  onClick={onSkip}
                  className="flex-1 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-extrabold tracking-wider uppercase transition-all shadow-xs flex items-center justify-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5" />
                  Resume Search
                </button>
              </div>

              {/* Collapsed tags editing area */}
              {showInterestsEditor && (
                <div className="p-3 bg-white border border-slate-100 rounded-lg space-y-3 animate-slideDown shadow-2xs">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Double click or press ',' / enter to add tag</span>
                  </div>
                  
                  {/* Dynamic tag container */}
                  <div className="flex flex-wrap gap-1 bg-slate-50 border border-slate-200/60 rounded-lg p-1.5 min-h-[38px]">
                    {interests.map((tag) => (
                      <span key={tag} className="inline-flex items-center gap-1 bg-indigo-600 text-white pl-2 pr-1 py-0.5 rounded-md text-xs font-semibold shadow-3xs">
                        {tag}
                        <button 
                          type="button" 
                          onClick={() => onRemoveInterest(tag)} 
                          className="p-0.5 hover:bg-indigo-500 rounded"
                        >
                          <X className="w-3 h-3 text-indigo-100 hover:text-white" />
                        </button>
                      </span>
                    ))}
                    <input
                      type="text"
                      placeholder="Add tag..."
                      value={localInterestInput}
                      onChange={(e) => setLocalInterestInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === ",") {
                          e.preventDefault();
                          const val = localInterestInput.trim().toLowerCase();
                          if (val) {
                            onAddInterest(val);
                            setLocalInterestInput("");
                          }
                        }
                      }}
                      className="flex-1 bg-transparent border-0 outline-hidden p-0 px-2 text-xs font-medium text-slate-800 shrink-0 min-w-[100px]"
                    />
                  </div>

                  {/* Suggestions list */}
                  <div className="space-y-1">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide block">Popular tags:</span>
                    <div className="flex flex-wrap gap-1">
                      {POPULAR_SUGGESTIONS.map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => onAddInterest(item)}
                          disabled={interests.includes(item)}
                          className="bg-slate-50 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 disabled:opacity-40 border border-slate-200/60 px-2 py-0.5 rounded text-[10px] font-semibold transition-all shrink-0"
                        >
                          + {item}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty placeholder if no messages */}
        {messages.length === 0 && !isSearching && !isPaired && (
          <div className="flex flex-col items-center justify-center min-h-[420px] text-center max-w-sm mx-auto space-y-4 py-4">
            <div className="flex flex-col items-center justify-center space-y-2">
              <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-full text-slate-400">
                <Shield className="w-5 h-5 text-slate-400" />
              </div>
              <p className="text-xs font-bold text-slate-650 text-slate-705 text-slate-600 uppercase tracking-wider">Lobby Screen Ready</p>
              <p className="text-[11px] text-slate-500 leading-normal">
                Press <strong>Resume Search</strong> to pair. Change your interests tags anytime.
              </p>
            </div>
            
            {/* Dynamic Adsterra unit in Lobby area */}
            <div className="flex flex-col items-center gap-1 py-1 text-center bg-white border border-slate-100 p-2 rounded-xl shadow-3xs max-w-[320px]">
              <AdContainer idKey="e3b922214b1e162ec763d9f9c81590e1" width={300} height={250} className="rounded-lg shadow-2xs border border-slate-50" />
            </div>
          </div>
        )}

        {/* Message elements */}
        {messages.map((msg) => {
          if (msg.sender === "system") {
            return (
              <div key={msg.id} className="flex justify-center my-3">
                <span className="bg-slate-100 border border-slate-200/60 text-slate-600 text-[10px] font-mono py-1 px-3 rounded-full shadow-3xs tracking-wide">
                  {msg.text}
                </span>
              </div>
            );
          }

          const isSelf = msg.sender === "you";
          return (
            <div 
              key={msg.id} 
              className={`flex flex-col ${isSelf ? "items-end" : "items-start"}`}
            >
              <div 
                className={`max-w-[85%] sm:max-w-[70%] py-2.5 px-4 rounded-2xl text-sm leading-relaxed ${
                  isSelf 
                    ? "bg-indigo-600 text-white rounded-tr-none shadow-xs" 
                    : "bg-slate-100 text-slate-800 rounded-tl-none border border-slate-205 bg-slate-100 border-slate-250"
                }`}
              >
                {msg.text}
              </div>
              <span className="text-[10px] text-slate-400 mt-1 px-1 tracking-tight">
                {isSelf ? "You" : "Stranger"} • {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
          );
        })}

        {/* Stranger Typing State */}
        {strangerIsTyping && (
          <div className="flex items-center gap-1.5 text-slate-450 text-xs px-2 py-1.5 bg-slate-50 border border-slate-100 w-fit rounded-xl rounded-tl-none animate-pulse">
            <span className="font-semibold text-slate-500 text-xs">Stranger is typing</span>
            <span className="flex gap-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
          </div>
        )}
      </div>

      {/* Message and matching interface */}
      <div className="p-2 sm:p-4 border-t border-slate-100 bg-white shadow-md shrink-0">
        <form onSubmit={handleFormSubmit} className="flex gap-2 sm:gap-3 items-start">
          
          {/* Stop / Search Trigger control column */}
          <div className="flex flex-col items-center shrink-0">
            {(isPaired || isSearching) ? (
              <button
                id="btn-shortcut-skip"
                type="button"
                onClick={triggerSkipAction}
                className={`px-2 py-1 h-[42px] w-[84px] sm:h-[52px] sm:w-[112px] rounded-lg sm:rounded-xl font-extrabold transition-all flex items-center justify-center shrink-0 uppercase tracking-widest text-[10px] sm:text-[11px] select-none shadow-xs text-center ${
                  confirmStop
                    ? "bg-rose-600 hover:bg-rose-700 text-white animate-pulse"
                    : isSearching 
                      ? "bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200"
                      : "bg-slate-800 hover:bg-slate-900 text-slate-100"
                }`}
              >
                {confirmStop ? "Really?" : isSearching ? "Stop" : "Skip (Esc)"}
              </button>
            ) : (
              <button
                id="btn-shortcut-start"
                type="button"
                onClick={onSkip}
                className="px-2 py-1 h-[42px] w-[84px] sm:h-[52px] sm:w-[112px] bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg sm:rounded-xl font-extrabold transition-all flex items-center justify-center shrink-0 uppercase tracking-widest text-[10px] sm:text-[11px] shadow-xs text-center"
              >
                Connect
              </button>
            )}
          </div>

          {/* Chat text box */}
          <div className="relative flex-1 flex h-[42px] sm:h-[52px]">
            <input
              id="input-text-message"
              type="text"
              autoFocus
              disabled={!isPaired}
              placeholder={isPaired ? "Type your message..." : "Match paused. Connect..."}
              value={inputText}
              onChange={handleInputChange}
              className="w-full h-full pl-3 sm:pl-4 pr-10 sm:pr-12 rounded-lg sm:rounded-xl bg-slate-50 border border-slate-200 shadow-inner text-xs sm:text-sm font-medium focus:outline-hidden focus:ring-2 focus:ring-indigo-600/25 focus:border-indigo-600 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
            />
            
            <button
              id="btn-submit-message"
              type="submit"
              disabled={!isPaired || !inputText.trim()}
              className="absolute right-1 sm:right-2 top-1 sm:top-1.5 p-1.5 sm:p-2 h-8 w-8 sm:h-9 sm:w-9 bg-indigo-600 rounded-md sm:rounded-lg hover:bg-indigo-700 text-white flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-indigo-600"
            >
              <Send className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
