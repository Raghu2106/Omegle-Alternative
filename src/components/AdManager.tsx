import { useEffect, useRef, useState } from "react";

// Ad Configuration Definition
// The user can edit these values once they have their live ad units from
// Adsterra, Monetag, or any other premium ad networks.
const CONFIG = {
  // Replace with actual Social Bar script URL or set in window.U_SOCIAL_BAR_URL
  socialBarScriptUrl: "https://eternalwheeled.com/50/dd/f7/50ddf7c233c24a2a7a14e1ec61ca86cb.js", // Live Social Bar URL
  socialBarKey: "50ddf7c233c24a2a7a14e1ec61ca86cb", // Live Social Bar identifier key
  
  // Replace with actual Popunder script URL or set in window.U_POPUNDER_URL
  popunderScriptUrl: "https://eternalwheeled.com/ea/42/41/ea424104c88749835d911a6401e9db6e.js", // Live Popunder URL
  popunderKey: "ea424104c88749835d911a6401e9db6e", // Live Popunder identifier key

  // Durations
  socialBarIntervalMs: 5 * 60 * 1000, // 5 minutes
  popunderDelayMs: 2 * 60 * 1000, // 2 minutes delay
};

export default function AdManager() {
  const [socialBarActive, setSocialBarActive] = useState(false);
  const [popunderReady, setPopunderReady] = useState(false);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  
  const socialBarTimerRef = useRef<NodeJS.Timeout | null>(null);
  const popunderTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Intercept and reposition floating Social Bar overlays to render under the header in the center
  useEffect(() => {
    const repositionInjectedAdNodes = () => {
      const children = Array.from(document.body.children);
      children.forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        
        // Exclude system react roots and dev server panels
        if (
          el.id === "root" || 
          el.id === "ad-manager-status" || 
          el.tagName === "SCRIPT" || 
          el.tagName === "STYLE" || 
          el.id?.includes("vite") ||
          el.id?.includes("next")
        ) {
          return;
        }

        const computedStyle = window.getComputedStyle(el);
        const position = computedStyle.position;
        const zIndex = parseInt(computedStyle.zIndex, 10);

        // Target high z-index overlay banners/notifications injected near the top
        if ((position === "fixed" || position === "absolute") && (zIndex > 1000 || isNaN(zIndex))) {
          const isMobile = window.innerWidth < 1024;
          const headerHeight = isMobile ? 64 : 110;

          // Safe positioning: Center horizontally underneath the header bar
          el.style.setProperty("top", `${headerHeight + 12}px`, "important");
          el.style.setProperty("left", "50%", "important");
          el.style.setProperty("right", "auto", "important");
          el.style.setProperty("transform", "translateX(-50%)", "important");
          el.style.setProperty("margin-left", "0px", "important");
          el.style.setProperty("margin-right", "0px", "important");

          if (!el.dataset.repositioned) {
            el.dataset.repositioned = "true";
            console.log(
              "%c[AdManager] Repositioned floating overlay element away from header controls to pagespace center under nav.",
              "color: #8b5cf6; font-weight: bold;",
              el
            );
          }
        }
      });
    };

    // Instantiate high performance live observer for immediate interception
    const observer = new MutationObserver((mutations) => {
      repositionInjectedAdNodes();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Fallback interval check for late style bindings
    const repositionInterval = setInterval(repositionInjectedAdNodes, 1000);

    return () => {
      observer.disconnect();
      clearInterval(repositionInterval);
    };
  }, []);

  useEffect(() => {
    // 1. Session tracking for Pop-Under Ad
    // We check if we already have a session start timestamp in sessionStorage to remain accurate across accidental refreshes.
    const storedStartTimeVal = sessionStorage.getItem("umegle_session_start_time");
    let startTime = storedStartTimeVal ? parseInt(storedStartTimeVal, 10) : null;
    
    if (!startTime) {
      startTime = Date.now();
      sessionStorage.setItem("umegle_session_start_time", startTime.toString());
    }
    setSessionStartTime(startTime);

    // Diagnostic console greeting for the site administrator
    console.log(
      "%c[AdManager] Active Session tracking initialized.", 
      "color: #8b5cf6; font-weight: bold;", 
      `Started: ${new Date(startTime).toLocaleTimeString()}`
    );

    // 2. Setup Social Bar Loading & Re-evaluation Loop (Once per 5 minutes)
    const runSocialBarCycle = () => {
      const lastSocialBarLoadedVal = localStorage.getItem("umegle_last_social_bar_loaded");
      const lastLoaded = lastSocialBarLoadedVal ? parseInt(lastSocialBarLoadedVal, 10) : 0;
      const now = Date.now();

      if (now - lastLoaded >= CONFIG.socialBarIntervalMs) {
        // Clear old social bar script instances if they exist
        const oldScript = document.getElementById("umegle-social-bar-script");
        if (oldScript) {
          oldScript.remove();
        }

        // Trigger loading the script
        console.log("%c[AdManager] Loading Social Bar ad. Next refresh in 5 minutes.", "color: #06b6d4; font-weight: bold;");
        
        const script = document.createElement("script");
        script.id = "umegle-social-bar-script";
        script.type = "text/javascript";
        // Support either a globally defined override (for easy run-time setup) or static configuration
        const scriptSrc = (window as any).U_SOCIAL_BAR_URL || CONFIG.socialBarScriptUrl;
        script.src = scriptSrc;
        script.async = true;
        
        // Some ad scripts require specific globals to execute correctly, e.g. atOptions keys
        const adKey = (window as any).U_SOCIAL_BAR_KEY || CONFIG.socialBarKey;
        if (adKey) {
          (window as any).atOptions = {
            ...(window as any).atOptions,
            'key': adKey,
            'format': 'iframe',
            'height': 250,
            'width': 300,
            'params': {}
          };
        }

        document.body.appendChild(script);
        localStorage.setItem("umegle_last_social_bar_loaded", now.toString());
        setSocialBarActive(true);
      } else {
        const remainingMs = CONFIG.socialBarIntervalMs - (now - lastLoaded);
        const remainingMins = Math.ceil(remainingMs / 1000 / 60);
        console.log(
          `%c[AdManager] Social Bar in cooldown. Displayed recently. Next allowed refresh in ~${remainingMins} min.`, 
          "color: #94a3b8;"
        );
      }
    };

    // Run immediately on mount
    runSocialBarCycle();

    // Check every minute to see if a new 5-minute cycle can be executed
    socialBarTimerRef.current = setInterval(runSocialBarCycle, 60 * 1000);

    // 3. Setup Pop-under Trigger (Once per session, after a 2 minute delay)
    const runPopunderTimer = () => {
      const popunderShown = sessionStorage.getItem("umegle_popunder_shown") === "true";
      if (popunderShown) {
        console.log("%c[AdManager] Pop-Under already triggered once for this session. Suppressed.", "color: #f43f5e;");
        return;
      }

      const elapsedMs = Date.now() - (startTime || Date.now());
      if (elapsedMs >= CONFIG.popunderDelayMs) {
        triggerPopunderElement();
      } else {
        const waitTimeRemaining = CONFIG.popunderDelayMs - elapsedMs;
        console.log(
          `%c[AdManager] Pop-Under scheduled. Will fire in ${(waitTimeRemaining / 1000).toFixed(0)}s (Once per session)`, 
          "color: #e11d48; font-weight: bold;"
        );

        popunderTimerRef.current = setTimeout(() => {
          triggerPopunderElement();
        }, waitTimeRemaining);
      }
    };

    const triggerPopunderElement = () => {
      console.log("%c[AdManager] Session duration surpassed 2 minutes. Launching Pop-Under integration.", "color: #10b981; font-weight: bold;");
      
      const script = document.createElement("script");
      script.id = "umegle-popunder-script";
      script.type = "text/javascript";
      const scriptSrc = (window as any).U_POPUNDER_URL || CONFIG.popunderScriptUrl;
      script.src = scriptSrc;
      script.async = true;

      const adKey = (window as any).U_POPUNDER_KEY || CONFIG.popunderKey;
      if (adKey) {
        (window as any).atOptions = {
          ...(window as any).atOptions,
          'key': adKey,
          'format': 'iframe',
          'height': 250,
          'width': 300,
          'params': {}
        };
      }

      document.body.appendChild(script);
      sessionStorage.setItem("umegle_popunder_shown", "true");
      setPopunderReady(true);
    };

    runPopunderTimer();

    return () => {
      if (socialBarTimerRef.current) clearInterval(socialBarTimerRef.current);
      if (popunderTimerRef.current) clearTimeout(popunderTimerRef.current);
    };
  }, [sessionStartTime]);

  return (
    <div id="ad-manager-status" className="hidden" aria-hidden="true" data-social-bar={socialBarActive} data-popunder={popunderReady}>
      {/* 
        This is a non-visual container that coordinates script execution.
        We provide global administrative handles in window so the user can easily swap
        script URLs dynamically in their production console or environment.
      */}
    </div>
  );
}
