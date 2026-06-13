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
    <div className="flex flex-col h-full bg-[#fcfdfd]" id="widget-chat-panel">
      
      {/* Upper header with Match Details & Auto-connect / Pause options */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-5 py-3 border-b border-slate-100 bg-white gap-2 shadow-2xs">
        
        {/* Connection status container */}
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${
            isPaired 
              ? "bg-emerald-500 animate-pulse" 
              : isSearching 
                ? "bg-indigo-505 bg-indigo-500 animate-pulse" 
                : "bg-amber-400"
          }`} />
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
            {isPaired 
              ? "Talking to stranger" 
              : isSearching 
                ? "Matching pool..." 
                : "Match Lobby Paused"}
          </h2>
        </div>
        
        {/* Interests Overlay if matched */}
        {isPaired && commonInterests.length > 0 && (
          <div className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-100/50 px-2.5 py-0.5 rounded-md text-[11px] text-indigo-700">
            <Sparkles className="w-3 h-3 text-indigo-500" />
            <span className="font-semibold">Tags:</span>
            <span className="font-medium truncate max-w-[150px]">{commonInterests.join(", ")}</span>
          </div>
        )}

        {/* Global toggles and back to dashboard option */}
        <div className="flex items-center gap-2 flex-wrap">
          
          {/* Unsolicited auto load pause toggle */}
          <label className="flex items-center gap-2 bg-slate-50 border border-slate-205 border-slate-200/70 px-2.5 py-1 rounded-lg select-none cursor-pointer hover:bg-slate-100 transition-colors">
            <input
              type="checkbox"
              checked={autoConnect}
              onChange={onToggleAutoConnect}
              className="h-3.5 w-3.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 transition-colors cursor-pointer"
            />
            <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
              Auto-Connect Next
            </span>
          </label>

          <button
            id="btn-exit-lobby"
            type="button"
            onClick={onStop}
            className="text-[10px] font-bold text-rose-600 hover:text-white hover:bg-rose-600 px-2.5 py-1.5 rounded-lg border border-rose-150 transition-all uppercase tracking-wider bg-transparent"
          >
            Exit to Home
          </button>
        </div>
      </div>

      {/* Main Messages Container */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-5 py-6 space-y-4 scrollbar-thin scrollbar-thumb-slate-200"
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
              <span className="text-[8px] font-extrabold text-slate-400 tracking-widest uppercase">Sponsored</span>
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
      <div className="p-4 border-t border-slate-100 bg-white shadow-md">
        <form onSubmit={handleFormSubmit} className="flex gap-3 items-start">
          
          {/* Stop / Search Trigger control column */}
          <div className="flex flex-col items-center shrink-0">
            {(isPaired || isSearching) ? (
              <button
                id="btn-shortcut-skip"
                type="button"
                onClick={triggerSkipAction}
                className={`px-3 py-3.5 h-[52px] w-[112px] rounded-xl font-extrabold transition-all flex items-center justify-center shrink-0 uppercase tracking-widest text-[11px] select-none shadow-xs text-center ${
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
                className="px-3 py-3.5 h-[52px] w-[112px] bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-extrabold transition-all flex items-center justify-center shrink-0 uppercase tracking-widest text-[11px] shadow-xs text-center"
              >
                Connect
              </button>
            )}
          </div>

          {/* Chat text box */}
          <div className="relative flex-1 flex h-[52px]">
            <input
              id="input-text-message"
              type="text"
              autoFocus
              disabled={!isPaired}
              placeholder={isPaired ? "Type your message to stranger here..." : "Match lobby paused. Connect to chat..."}
              value={inputText}
              onChange={handleInputChange}
              className="w-full h-full pl-4 pr-12 rounded-xl bg-slate-50 border border-slate-200 shadow-inner text-sm font-medium focus:outline-hidden focus:ring-2 focus:ring-indigo-600/25 focus:border-indigo-600 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
            />
            
            <button
              id="btn-submit-message"
              type="submit"
              disabled={!isPaired || !inputText.trim()}
              className="absolute right-2 top-1.5 p-2 h-9 w-9 bg-indigo-600 rounded-lg hover:bg-indigo-700 text-white flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-indigo-600"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
