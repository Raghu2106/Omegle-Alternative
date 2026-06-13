// Google Analytics Module
// Manages standard tracking events, script loading, and iframe security configurations.

declare global {
  interface Window {
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
  }
}

const GA_MEASUREMENT_ID = ((import.meta as any).env?.VITE_GA_MEASUREMENT_ID as string) || "G-EB0YSMTQDY";

/**
 * Initializes Google Analytics 4 in the browser dynamically.
 * Configures cookie security policies optimized for iframe embeds.
 */
export function initGA() {
  if (!GA_MEASUREMENT_ID) {
    console.warn("Analytics: VITE_GA_MEASUREMENT_ID environment variable is missing. Telemetry is running in console/debug-only mode.");
    return;
  }

  // Prevent double inclusion
  if (window.gtag) return;

  try {
    // 1. Append external gtag script
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
    document.head.appendChild(script);

    // 2. Initialize tracking layer
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer?.push(arguments);
    };

    // 3. Fire-up configuration
    window.gtag("js", new Date());

    // Configure Measurement ID with SameSite policies to prevent security blocks 
    // when running inside single-page container and iframe dashboards.
    window.gtag("config", GA_MEASUREMENT_ID, {
      send_page_view: true,
      cookie_flags: "SameSite=None;Secure",
      cookie_update: false,
    });

    console.info(`Analytics: Connected successfully to GA4 (ID: ${GA_MEASUREMENT_ID})`);
  } catch (error) {
    console.error("Analytics Error: Failed to bootstrap standard tracking scripts.", error);
  }
}

/**
 * Safely events analytics tracker proxying to GA4 or logging to debug interface.
 * 
 * @param eventName Name of the telemetry action event tracking
 * @param params Associated attributes & metrics to enrich analytics reports
 */
export function trackEvent(eventName: string, params?: Record<string, any>) {
  if (window.gtag && GA_MEASUREMENT_ID) {
    window.gtag("event", eventName, params);
  } else {
    // Clear developer-facing analytics pipeline output
    console.log(`📊 [GA Event Preview] Name: "${eventName}"`, params);
  }
}
