import { useEffect, useRef, useState } from "react";

// Declare vad global from CDN
declare global {
  interface Window {
    vad: any;
    __notifyGeminiResponse?: () => void;
  }
}

interface VoiceActivityMonitorProps {
  isActive: boolean;
  onShouldSendChange: (shouldSend: boolean) => void;
  onGeminiResponseReceived?: () => void;
  onUserSpeakingChange?: (isSpeaking: boolean) => void;
}

// Configuration: Timeout before stopping audio transmission (in milliseconds)
export const INACTIVITY_TIMEOUT = 1 * 20 * 1000; // 1 minute - change this value to adjust timeout

export const VoiceActivityMonitor: React.FC<VoiceActivityMonitorProps> = ({
  onShouldSendChange,
  onUserSpeakingChange,
}) => {
  const [lastSpeechTime, setLastSpeechTime] = useState<number>(Date.now());
  const [lastGeminiResponseTime, setLastGeminiResponseTime] = useState<number>(
    Date.now(),
  );
  const [vadLoading, setVadLoading] = useState(true);
  const [vadError, setVadError] = useState(false);
  const [vadListening, setVadListening] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [, forceUpdate] = useState(0); // For forcing UI updates

  const geminiResponseCallbackRef = useRef<(() => void) | null>(null);
  const vadInstanceRef = useRef<any>(null);
  const speechTimeoutRef = useRef<number | null>(null);

  // Initialize VAD
  useEffect(() => {
    const initVAD = async () => {
      try {
        console.log("[VAD] Initializing...");

        // Wait for vad global to be available
        if (!window.vad) {
          console.log("[VAD] Waiting for vad library...");
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        const myvad = await window.vad.MicVAD.new({
          onSpeechStart: () => {
            console.log("[VAD] Speech started");
            setUserSpeaking(true);
            setLastSpeechTime(Date.now());

            // Notify parent component that user is speaking
            if (onUserSpeakingChange) {
              onUserSpeakingChange(true);
            }

            // Clear any existing timeout
            if (speechTimeoutRef.current) {
              clearTimeout(speechTimeoutRef.current);
            }

            // Set a safety timeout to force end speech detection after 10 seconds
            speechTimeoutRef.current = setTimeout(() => {
              console.log("[VAD] Force ending speech detection (timeout)");
              setUserSpeaking(false);
              if (onUserSpeakingChange) {
                onUserSpeakingChange(false);
              }
            }, 10000);
          },
          onSpeechEnd: () => {
            console.log("[VAD] Speech ended");
            setUserSpeaking(false);

            // Notify parent component that user stopped speaking
            if (onUserSpeakingChange) {
              onUserSpeakingChange(false);
            }

            // Clear the safety timeout
            if (speechTimeoutRef.current) {
              clearTimeout(speechTimeoutRef.current);
              speechTimeoutRef.current = null;
            }
          },
        });

        vadInstanceRef.current = myvad;
        setVadLoading(false);
        setVadListening(true);
        console.log("[VAD] Started successfully");

        myvad.start();
      } catch (error) {
        console.error("[VAD] Error initializing:", error);
        setVadError(true);
        setVadLoading(false);
      }
    };

    initVAD();

    return () => {
      if (vadInstanceRef.current) {
        try {
          // VAD library uses pause() instead of destroy()
          vadInstanceRef.current.pause();
        } catch (error) {
          console.error('[VAD] Error cleaning up:', error);
        }
      }
    };
  }, []);

  // Expose method to notify about Gemini responses
  useEffect(() => {
    geminiResponseCallbackRef.current = () => {
      console.log("[VAD] Gemini response received");
      setLastGeminiResponseTime(Date.now());
    };
  }, []);

  // Force UI update every second to update time displays
  useEffect(() => {
    const interval = setInterval(() => {
      forceUpdate((n) => n + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Check activity and update shouldSend flag
  useEffect(() => {
    const checkActivity = () => {
      const now = Date.now();
      const timeSinceLastSpeech = now - lastSpeechTime;
      const timeSinceLastGemini = now - lastGeminiResponseTime;

      const isInactive =
        timeSinceLastSpeech > INACTIVITY_TIMEOUT &&
        timeSinceLastGemini > INACTIVITY_TIMEOUT;

      const shouldSend = !isInactive;

      console.log("[VAD] Activity check:", {
        shouldSend,
        timeSinceLastSpeech: Math.floor(timeSinceLastSpeech / 1000) + "s",
        timeSinceLastGemini: Math.floor(timeSinceLastGemini / 1000) + "s",
        userSpeaking,
        isInactive,
        timeout: INACTIVITY_TIMEOUT / 1000 + "s",
      });

      onShouldSendChange(shouldSend);
    };

    // Check every 5 seconds (more frequent)
    const interval = setInterval(checkActivity, 5000);
    checkActivity(); // Initial check

    return () => clearInterval(interval);
  }, [
    lastSpeechTime,
    lastGeminiResponseTime,
    onShouldSendChange,
    userSpeaking,
  ]);

  // Expose the Gemini response callback
  useEffect(() => {
    if (geminiResponseCallbackRef.current) {
      window.__notifyGeminiResponse = geminiResponseCallbackRef.current;
    }
  }, []);

  return (
    <div className="card fixed bottom-4 right-4 bg-base-300/80 backdrop-blur-sm shadow-xl">
      <div className="card-body p-4 text-sm">
        <div className="flex items-center gap-2">
          <span
            className={`badge ${
              vadLoading
                ? "badge-warning"
                : vadError
                  ? "badge-error"
                  : vadListening
                    ? "badge-success"
                    : "badge-ghost"
            }`}
          >
            {vadLoading ? "Loading" : vadError ? "Error" : vadListening ? "Active" : "Inactive"}
          </span>
          <span className="font-semibold text-base-content">VAD Status</span>
        </div>

        {vadLoading && (
          <div className="text-xs text-warning">Loading model...</div>
        )}
        {vadError && (
          <div className="text-xs text-error">Error loading VAD</div>
        )}

        {vadListening && (
          <div className="stats stats-vertical shadow bg-base-200">
            <div className="stat py-2 px-3">
              <div className="stat-title text-xs">Speaking</div>
              <div className="stat-value text-sm">
                <span
                  className={`badge ${userSpeaking ? "badge-success" : "badge-ghost"}`}
                >
                  {userSpeaking ? "Yes" : "No"}
                </span>
              </div>
            </div>
            <div className="stat py-2 px-3">
              <div className="stat-title text-xs">Last Speech</div>
              <div className="stat-value text-sm text-base-content">
                {Math.floor((Date.now() - lastSpeechTime) / 1000)}s ago
              </div>
            </div>
            <div className="stat py-2 px-3">
              <div className="stat-title text-xs">Last Gemini</div>
              <div className="stat-value text-sm text-base-content">
                {Math.floor((Date.now() - lastGeminiResponseTime) / 1000)}s ago
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Export helper to notify about Gemini responses
export const notifyGeminiResponse = () => {
  if (window.__notifyGeminiResponse) {
    window.__notifyGeminiResponse();
  }
};
