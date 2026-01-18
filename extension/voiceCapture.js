/**
 * VoiceCapture - Handles voice activity detection and audio streaming
 * Automatically detects speech start/end and streams audio chunks via WebSocket
 */

class VoiceCapture {
  constructor(options = {}) {
    // WebSocket configuration
    this.wsUrl = options.wsUrl || "ws://localhost:3000/ws/voice";
    this.userId = options.userId || this.generateId();
    this.sessionId = options.sessionId || this.generateId();
    this.documentId = options.documentId || null; // UUID from documents table
    this.docText = options.docText || null; // Document text content for context

    // VAD configuration - thresholds tuned to reduce background noise sensitivity
    this.speechThreshold = options.speechThreshold || 0.12; // RMS threshold for speech detection
    this.bargeInThreshold = options.bargeInThreshold || 0.2; // Higher threshold for interrupting during playback
    this.silenceDuration = options.silenceDuration || 1000; // ms before ending utterance
    this.minSpeechDuration = options.minSpeechDuration || 300; // ms minimum to count as speech (filters short noise)

    // Audio configuration
    this.sampleRate = options.sampleRate || 16000; // 16kHz is standard for STT
    this.chunkSize = options.chunkSize || 4096;

    // State
    this.ws = null;
    this.audioContext = null;
    this.mediaStream = null;
    this.processor = null;
    this.analyser = null;
    this.isRecording = false;
    this.isSpeaking = false;
    this.isPaused = false; // Track if we're in "paused" mode (audio playing)
    this.silenceTimeout = null;
    this.speechStartTime = null;
    this.sequence = 0;

    // Callbacks
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onVolumeChange = options.onVolumeChange || (() => {});
    this.onSpeechStart = options.onSpeechStart || (() => {});
    this.onSpeechEnd = options.onSpeechEnd || (() => {});
    this.onError = options.onError || ((err) => console.error(err));
    this.onAgentResponse = options.onAgentResponse || (() => {});
    this.onConnectionChange = options.onConnectionChange || (() => {});
    this.onInterrupt = options.onInterrupt || (() => {});
  }

  generateId() {
    return "id_" + Math.random().toString(36).substring(2, 15);
  }

  /**
   * Initialize WebSocket connection
   */
  async connectWebSocket() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = () => {
          console.log("WebSocket connected");
          this.onConnectionChange({ connected: true });

          // Send initial connection message
          this.sendMessage({
            type: "connection_init",
            userId: this.userId,
            sessionId: this.sessionId,
            documentId: this.documentId,
            docText: this.docText,
            timestamp: Date.now(),
          });

          resolve();
        };

        this.ws.onclose = (event) => {
          console.log("WebSocket closed:", event.code, event.reason);
          this.onConnectionChange({ connected: false, code: event.code });
        };

        this.ws.onerror = (error) => {
          console.error("WebSocket error:", error);
          this.onError(new Error("WebSocket connection failed"));
          reject(error);
        };

        this.ws.onmessage = (event) => {
          this.handleServerMessage(event);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle messages from server
   */
  handleServerMessage(event) {
    try {
      const message = JSON.parse(event.data);

      switch (message.type) {
        case "agent_response":
          this.onAgentResponse({
            agentId: message.agentId,
            text: message.text,
            audio: message.audio,
          });
          break;

        case "interrupt":
          // Server is telling us to interrupt current audio playback
          console.log("Received interrupt signal from server");
          this.onInterrupt();
          break;

        case "agent_speaking":
          // Could pause user recording while agent speaks
          this.onStatusChange({
            status: "agent_speaking",
            agentId: message.agentId,
          });
          break;

        case "transcript":
          // Real-time transcript feedback
          this.onStatusChange({ status: "transcript", text: message.text });
          break;

        case "error":
          this.onError(new Error(message.message));
          break;

        default:
          console.log("Unknown message type:", message.type);
      }
    } catch (error) {
      console.error("Failed to parse server message:", error);
    }
  }

  /**
   * Send message via WebSocket
   */
  sendMessage(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  /**
   * Check microphone permission status
   */
  async checkMicrophonePermission() {
    try {
      // Check if permissions API is available
      if (navigator.permissions && navigator.permissions.query) {
        const result = await navigator.permissions.query({
          name: "microphone",
        });
        return result.state; // 'granted', 'denied', or 'prompt'
      }
      return "prompt"; // Assume we need to ask
    } catch (error) {
      // Some browsers don't support querying microphone permission
      return "prompt";
    }
  }

  /**
   * Start capturing audio
   */
  async start() {
    try {
      this.onStatusChange({ status: "initializing" });

      // Check permission status first
      const permissionStatus = await this.checkMicrophonePermission();

      if (permissionStatus === "denied") {
        throw new Error(
          "Microphone permission denied. Please allow microphone access in your browser settings and try again.",
        );
      }

      // Connect WebSocket first
      await this.connectWebSocket();

      // Request microphone access with better error handling
      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (micError) {
        // Handle specific microphone errors
        if (
          micError.name === "NotAllowedError" ||
          micError.name === "PermissionDeniedError"
        ) {
          throw new Error(
            "Microphone access was denied. Please click the camera icon in your browser's address bar to allow access, then try again.",
          );
        } else if (
          micError.name === "NotFoundError" ||
          micError.name === "DevicesNotFoundError"
        ) {
          throw new Error(
            "No microphone found. Please connect a microphone and try again.",
          );
        } else if (
          micError.name === "NotReadableError" ||
          micError.name === "TrackStartError"
        ) {
          throw new Error(
            "Microphone is being used by another application. Please close other apps using the microphone and try again.",
          );
        } else if (micError.name === "OverconstrainedError") {
          // Try again with simpler constraints
          this.mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
        } else {
          throw new Error(
            `Microphone error: ${micError.message || micError.name}`,
          );
        }
      }

      // Create audio context
      this.audioContext = new AudioContext({ sampleRate: this.sampleRate });

      // Handle browsers that don't support the requested sample rate
      if (this.audioContext.sampleRate !== this.sampleRate) {
        console.warn(
          `Requested ${this.sampleRate}Hz but got ${this.audioContext.sampleRate}Hz`,
        );
      }

      const source = this.audioContext.createMediaStreamSource(
        this.mediaStream,
      );

      // Create analyser for VAD
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.5;
      source.connect(this.analyser);

      // Create processor for capturing audio data
      // Using ScriptProcessorNode (deprecated but widely supported)
      // Could use AudioWorklet for better performance in production
      this.processor = this.audioContext.createScriptProcessor(
        this.chunkSize,
        1,
        1,
      );
      source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      this.processor.onaudioprocess = (event) => {
        if (this.isSpeaking) {
          this.processAudioChunk(event.inputBuffer.getChannelData(0));
        }
      };

      this.isRecording = true;
      this.onStatusChange({ status: "listening" });

      // Start VAD monitoring
      this.monitorVoiceActivity();

      return true;
    } catch (error) {
      this.onError(error);
      this.onStatusChange({ status: "error", message: error.message });
      return false;
    }
  }

  /**
   * Monitor voice activity using RMS volume
   * Continues monitoring even during "paused" state to detect barge-in
   */
  monitorVoiceActivity() {
    // Keep monitoring even when paused (for barge-in detection)
    if (!this.isRecording && !this.isPaused) return;

    const dataArray = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(dataArray);

    // Calculate RMS (Root Mean Square) for volume level
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / dataArray.length);

    // Normalize to 0-1 range for UI
    const normalizedVolume = Math.min(1, rms * 10);
    this.onVolumeChange(normalizedVolume);

    // Use higher threshold during playback to avoid feedback triggering
    const activeThreshold = this.isPaused
      ? this.bargeInThreshold
      : this.speechThreshold;

    // Voice activity detection
    if (rms > activeThreshold) {
      // If paused (audio playing) and user speaks, trigger barge-in
      if (this.isPaused && !this.isSpeaking) {
        console.log("Barge-in detected! User interrupting agent audio.");
        this.handleBargeIn();
        // handleBargeIn already handles speech start, continue to next frame
        requestAnimationFrame(() => this.monitorVoiceActivity());
        return;
      }

      // Normal speech detection (not paused)
      if (!this.isSpeaking) {
        this.speechStartTime = Date.now();
        this.handleSpeechStart();
      }

      // Reset silence timeout
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = setTimeout(() => {
        this.handleSpeechEnd();
      }, this.silenceDuration);
    }

    // Continue monitoring
    requestAnimationFrame(() => this.monitorVoiceActivity());
  }

  /**
   * Handle barge-in (user interrupting agent audio)
   */
  handleBargeIn() {
    // Trigger the interrupt callback first (stops audio in popup.js)
    this.onInterrupt();

    // Resume normal recording mode
    this.isPaused = false;

    // Set speaking state to prevent duplicate speech_start from monitorVoiceActivity
    this.isSpeaking = true;
    this.speechStartTime = Date.now();

    // Notify server of interruption
    this.sendMessage({
      type: "speech_start",
      userId: this.userId,
      sessionId: this.sessionId,
      documentId: this.documentId,
      timestamp: Date.now(),
      isBargeIn: true, // Flag to tell server this is an interruption
    });

    this.onSpeechStart();
    this.onStatusChange({ status: "speaking" });

    // Reset silence timeout for the new speech
    clearTimeout(this.silenceTimeout);
    this.silenceTimeout = setTimeout(() => {
      this.handleSpeechEnd();
    }, this.silenceDuration);

    console.log("Barge-in triggered - user interrupted agent audio");
  }

  /**
   * Handle detected speech start
   */
  handleSpeechStart() {
    this.isSpeaking = true;
    this.sequence = 0;

    const message = {
      type: "speech_start",
      userId: this.userId,
      sessionId: this.sessionId,
      documentId: this.documentId,
      timestamp: Date.now(),
    };

    this.sendMessage(message);
    this.onSpeechStart();
    this.onStatusChange({ status: "speaking" });

    console.log("Speech started");
  }

  /**
   * Handle detected speech end
   */
  handleSpeechEnd() {
    if (!this.isSpeaking) return;

    // Check minimum speech duration to filter out noise
    const speechDuration = Date.now() - this.speechStartTime;
    if (speechDuration < this.minSpeechDuration) {
      console.log("Speech too short, ignoring");
      this.isSpeaking = false;
      return;
    }

    this.isSpeaking = false;

    const message = {
      type: "speech_end",
      userId: this.userId,
      sessionId: this.sessionId,
      documentId: this.documentId,
      timestamp: Date.now(),
      duration: speechDuration,
    };

    this.sendMessage(message);
    this.onSpeechEnd();
    this.onStatusChange({ status: "processing" });

    console.log("Speech ended, duration:", speechDuration, "ms");
  }

  /**
   * Process and send audio chunk
   */
  processAudioChunk(float32Array) {
    // Convert Float32Array to Int16Array (16-bit PCM)
    const int16Array = this.floatTo16BitPCM(float32Array);

    // Convert to base64 for transmission
    const base64Data = this.arrayBufferToBase64(int16Array.buffer);

    const message = {
      type: "audio_chunk",
      userId: this.userId,
      sessionId: this.sessionId,
      data: base64Data,
      sequence: this.sequence++,
      sampleRate: this.audioContext.sampleRate,
      timestamp: Date.now(),
    };

    this.sendMessage(message);
  }

  /**
   * Convert Float32Array to Int16Array (16-bit PCM)
   */
  floatTo16BitPCM(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      // Clamp value between -1 and 1
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      // Convert to 16-bit integer
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16Array;
  }

  /**
   * Convert ArrayBuffer to base64 string
   */
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Pause recording (e.g., while agent is speaking)
   * Note: Voice monitoring continues for barge-in detection
   */
  pause() {
    if (this.isRecording && !this.isPaused) {
      this.isPaused = true;
      // Reset speaking state so we can detect fresh speech for barge-in
      this.isSpeaking = false;
      this.speechStartTime = null;
      this.onStatusChange({ status: "paused" });
      console.log("[VoiceCapture] Paused - monitoring for barge-in");
    }
  }

  /**
   * Resume recording
   */
  resume() {
    if (this.isPaused) {
      this.isPaused = false;
      this.onStatusChange({ status: "listening" });
      console.log("[VoiceCapture] Resumed normal listening");
    } else if (!this.isRecording && this.audioContext) {
      this.isRecording = true;
      this.onStatusChange({ status: "listening" });
      this.monitorVoiceActivity();
    }
  }

  /**
   * Stop capturing and clean up
   */
  stop() {
    this.isRecording = false;
    this.isSpeaking = false;

    clearTimeout(this.silenceTimeout);

    // Disconnect processor
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    // Stop media tracks
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    // Close audio context
    if (this.audioContext && this.audioContext.state !== "closed") {
      this.audioContext.close();
      this.audioContext = null;
    }

    // Close WebSocket
    if (this.ws) {
      this.sendMessage({
        type: "disconnect",
        userId: this.userId,
        sessionId: this.sessionId,
        timestamp: Date.now(),
      });
      this.ws.close();
      this.ws = null;
    }

    this.onStatusChange({ status: "stopped" });
    console.log("Voice capture stopped");
  }

  /**
   * Update configuration
   */
  setConfig(config) {
    if (config.speechThreshold !== undefined) {
      this.speechThreshold = config.speechThreshold;
    }
    if (config.silenceDuration !== undefined) {
      this.silenceDuration = config.silenceDuration;
    }
    if (config.userId !== undefined) {
      this.userId = config.userId;
    }
    if (config.sessionId !== undefined) {
      this.sessionId = config.sessionId;
    }
  }

  /**
   * Get current state
   */
  getState() {
    return {
      isRecording: this.isRecording,
      isSpeaking: this.isSpeaking,
      userId: this.userId,
      sessionId: this.sessionId,
      wsConnected: this.ws && this.ws.readyState === WebSocket.OPEN,
    };
  }
}

// Export for use in extension
if (typeof module !== "undefined" && module.exports) {
  module.exports = VoiceCapture;
}
