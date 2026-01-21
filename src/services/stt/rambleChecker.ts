/**
 * RambleChecker - Checks availability of local Ramble STT app
 *
 * Ramble is a macOS app that handles speech-to-text locally:
 * 1. Detects Right Command key globally
 * 2. Records and transcribes speech
 * 3. Pastes the transcription into the focused application
 *
 * This checker simply pings the WebSocket to see if Ramble is running.
 * Uses exponential backoff for reconnection attempts.
 */

class RambleChecker {
  private static instance: RambleChecker;
  private isAvailable = false;
  private checkTimeout: number | null = null;

  // Exponential backoff config
  private reconnectAttempts = 0;
  private readonly BASE_DELAY = 1000;
  private readonly MAX_DELAY = 30000;
  private readonly WEBSOCKET_URL = 'ws://localhost:49999';
  private readonly CONNECTION_TIMEOUT = 2000;

  private constructor() {}

  static getInstance(): RambleChecker {
    if (!this.instance) {
      this.instance = new RambleChecker();
    }
    return this.instance;
  }

  /**
   * Check if Ramble is available by attempting to connect to its WebSocket
   */
  async checkAvailability(): Promise<boolean> {
    return new Promise((resolve) => {
      const ws = new WebSocket(this.WEBSOCKET_URL);

      const timeout = setTimeout(() => {
        ws.close();
        this.handleUnavailable();
        resolve(false);
      }, this.CONNECTION_TIMEOUT);

      ws.onopen = () => {
        clearTimeout(timeout);
        ws.close();
        this.isAvailable = true;
        this.reconnectAttempts = 0; // Reset backoff on success
        console.log('[RambleChecker] Ramble is available');
        resolve(true);
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        this.handleUnavailable();
        resolve(false);
      };
    });
  }

  /**
   * Handle unavailable state and schedule reconnect with backoff
   */
  private handleUnavailable(): void {
    const wasAvailable = this.isAvailable;
    this.isAvailable = false;

    if (wasAvailable) {
      console.log('[RambleChecker] Ramble became unavailable');
    }

    this.scheduleReconnect();
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.checkTimeout) return; // Already scheduled

    const delay = Math.min(
      this.BASE_DELAY * Math.pow(2, this.reconnectAttempts),
      this.MAX_DELAY
    );
    this.reconnectAttempts++;

    console.log(
      `[RambleChecker] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`
    );

    this.checkTimeout = window.setTimeout(() => {
      this.checkTimeout = null;
      this.checkAvailability();
    }, delay);
  }

  /**
   * Check if Ramble is currently available (synchronous)
   */
  isRambleAvailable(): boolean {
    return this.isAvailable;
  }

  /**
   * Stop checking for availability
   */
  destroy(): void {
    if (this.checkTimeout) {
      clearTimeout(this.checkTimeout);
      this.checkTimeout = null;
    }
  }
}

export const rambleChecker = RambleChecker.getInstance();
