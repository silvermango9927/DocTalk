document.addEventListener("DOMContentLoaded", async () => {
  // Existing elements
  const signInBtn = document.getElementById("signInBtn");
  const signOutBtn = document.getElementById("signOutBtn");
  const extractBtn = document.getElementById("extractBtn");
  const copyBtn = document.getElementById("copyBtn");
  const statusDiv = document.getElementById("status");
  const contentDiv = document.getElementById("content");
  const contentArea = document.getElementById("contentArea");
  const wordCountDiv = document.getElementById("wordCount");

  // Voice elements
  const voiceSection = document.getElementById("voiceSection");
  const startVoiceBtn = document.getElementById("startVoiceBtn");
  const stopVoiceBtn = document.getElementById("stopVoiceBtn");
  const voiceIndicator = document.getElementById("voiceIndicator");
  const voiceStatusText = document.getElementById("voiceStatusText");
  const voiceStatusDetail = document.getElementById("voiceStatusDetail");
  const volumeBar = document.getElementById("volumeBar");
  const connectionDot = document.getElementById("connectionDot");
  const sessionIdDisplay = document.getElementById("sessionIdDisplay");
  const userIdDisplay = document.getElementById("userIdDisplay");
  const agentResponse = document.getElementById("agentResponse");
  const agentName = document.getElementById("agentName");
  const agentText = document.getElementById("agentText");

  let accessToken = null;
  let extractedText = "";
  let voiceCapture = null;
  let currentDocumentId = null; // UUID from backend documents table
  let currentSessionId = null; // UUID from backend sessions table
  let currentUserId = null; // UUID for the user
  let audioQueue = []; // Queue for agent audio responses
  let currentAudio = null; // Currently playing audio element
  let isPlayingAudio = false; // Flag to track if audio is playing

  // ==================== Configuration ====================

  // TODO: Update this URL when backend is ready
  const BACKEND_URL = "http://localhost:3000";
  const WS_URL = "ws://localhost:3000/ws/voice";

  // ==================== Auth Functions ====================

  async function checkAuthStatus() {
    const token = await getAuthToken(true);
    if (token) {
      accessToken = token;
      showSignedInState();
    } else {
      showSignedOutState();
    }
  }

  async function getAuthToken(interactive = false) {
    return new Promise((resolve) => {
      chrome.identity.getAuthToken({ interactive }, (token) => {
        if (chrome.runtime.lastError || !token) {
          console.log("Auth error:", chrome.runtime.lastError);
          resolve(null);
        } else {
          resolve(token);
        }
      });
    });
  }

  // ==================== Event Listeners ====================

  signInBtn.addEventListener("click", async () => {
    signInBtn.disabled = true;
    setStatus("info", "Signing in...");

    const token = await getAuthToken(true);
    if (token) {
      accessToken = token;
      showSignedInState();
      setStatus(
        "success",
        'Signed in successfully! Open a Google Doc and click "Extract Document".',
      );
    } else {
      setStatus("error", "Failed to sign in. Please try again.");
      signInBtn.disabled = false;
    }
  });

  signOutBtn.addEventListener("click", async () => {
    // Stop voice session if active
    if (voiceCapture) {
      voiceCapture.stop();
      voiceCapture = null;
    }

    if (accessToken) {
      await fetch(
        `https://accounts.google.com/o/oauth2/revoke?token=${accessToken}`,
      );
      chrome.identity.removeCachedAuthToken({ token: accessToken }, () => {
        accessToken = null;
        showSignedOutState();
        setStatus("info", "Signed out successfully.");
      });
    }
  });

  extractBtn.addEventListener("click", async () => {
    if (!accessToken) {
      setStatus("error", "Please sign in first.");
      return;
    }

    extractBtn.disabled = true;
    extractBtn.innerHTML =
      '<div class="loading"><span class="spinner"></span>Extracting...</div>';
    setStatus("info", "Extracting document content...");

    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab.url || !tab.url.includes("docs.google.com/document")) {
        setStatus("error", "Please open a Google Doc to extract content.");
        extractBtn.disabled = false;
        extractBtn.textContent = "Extract Document";
        return;
      }

      const docId = extractDocumentId(tab.url);
      if (!docId) {
        setStatus("error", "Could not extract document ID from URL.");
        extractBtn.disabled = false;
        extractBtn.textContent = "Extract Document";
        return;
      }

      const response = await fetch(
        `https://docs.googleapis.com/v1/documents/${docId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (!response.ok) {
        if (response.status === 401) {
          setStatus("error", "Authentication expired. Please sign in again.");
          showSignedOutState();
        } else {
          setStatus(
            "error",
            `API error: ${response.status} ${response.statusText}`,
          );
        }
        extractBtn.disabled = false;
        extractBtn.textContent = "Extract Document";
        return;
      }

      const data = await response.json();
      extractedText = extractTextFromDocument(data);

      if (extractedText.trim().length === 0) {
        setStatus("error", "No content found in the document.");
        contentDiv.textContent = "";
        contentArea.style.display = "none";
        voiceSection.style.display = "none";
      } else {
        // Send to backend and create session
        const backendData = await sendToBackend(
          docId,
          data.title,
          extractedText,
          tab.url,
        );

        if (backendData) {
          currentDocumentId = backendData.documentId; // UUID from backend
          currentSessionId = backendData.sessionId;
          currentUserId = backendData.userId;
        }

        setStatus(
          "success",
          "Content extracted! You can now start a voice conversation.",
        );
        contentDiv.textContent = extractedText;
        contentArea.style.display = "block";
        updateWordCount(extractedText);

        // Show voice section
        voiceSection.style.display = "block";
      }
    } catch (error) {
      console.error("Extraction error:", error);
      setStatus("error", `Error: ${error.message}`);
    } finally {
      extractBtn.disabled = false;
      extractBtn.textContent = "Extract Document";
    }
  });

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(extractedText);
      const originalText = copyBtn.textContent;
      copyBtn.textContent = "✓ Copied!";
      setTimeout(() => {
        copyBtn.textContent = originalText;
      }, 2000);
    } catch (error) {
      setStatus("error", "Failed to copy to clipboard.");
    }
  });

  // ==================== Voice Event Listeners ====================

  startVoiceBtn.addEventListener("click", async () => {
    startVoiceBtn.disabled = true;
    connectionDot.classList.add("connecting");
    setStatus("info", "Requesting microphone access...");

    try {
      // Use existing IDs from document extraction, or generate new ones
      const userId = currentUserId || generateUserId();
      const sessionId = currentSessionId || generateSessionId();

      // Update displays
      sessionIdDisplay.textContent = sessionId.substring(0, 8) + "...";
      userIdDisplay.textContent = userId.substring(0, 8) + "...";

      // Initialize voice capture with document context
      voiceCapture = new VoiceCapture({
        wsUrl: WS_URL,
        userId: userId,
        sessionId: sessionId,
        documentId: currentDocumentId, // UUID for linking messages to document
        docText: extractedText, // Document text content for AI context
        speechThreshold: 0.08,
        silenceDuration: 1000,

        onStatusChange: handleVoiceStatusChange,
        onVolumeChange: handleVolumeChange,
        onSpeechStart: handleSpeechStart,
        onSpeechEnd: handleSpeechEnd,
        onError: handleVoiceError,
        onAgentResponse: handleAgentResponse,
        onConnectionChange: handleConnectionChange,
        onInterrupt: stopAllAudio, // Stop audio when server sends interrupt
      });

      const started = await voiceCapture.start();

      if (started) {
        startVoiceBtn.style.display = "none";
        stopVoiceBtn.style.display = "block";
        setStatus(
          "success",
          "Voice session started! Speak to interact with the agents.",
        );

        // Hide permission help if it was showing
        const micPermissionHelp = document.getElementById("micPermissionHelp");
        if (micPermissionHelp) {
          micPermissionHelp.style.display = "none";
        }
      } else {
        throw new Error("Failed to start voice capture");
      }
    } catch (error) {
      console.error("Failed to start voice:", error);

      // Clean up if voice capture was partially initialized
      if (voiceCapture) {
        voiceCapture.stop();
        voiceCapture = null;
      }

      // Error will be handled by handleVoiceError, but also show in status
      handleVoiceError(error);
    }
  });

  stopVoiceBtn.addEventListener("click", () => {
    if (voiceCapture) {
      voiceCapture.stop();
      voiceCapture = null;
    }

    stopVoiceBtn.style.display = "none";
    startVoiceBtn.style.display = "block";
    startVoiceBtn.disabled = false;

    resetVoiceUI();
  });

  // ==================== Voice Handlers ====================

  function handleVoiceStatusChange(status) {
    console.log("Voice status:", status);

    // Remove all state classes
    voiceIndicator.classList.remove(
      "listening",
      "speaking",
      "processing",
      "error",
    );
    volumeBar.classList.remove("speaking");

    switch (status.status) {
      case "initializing":
        voiceStatusText.textContent = "Initializing...";
        voiceStatusDetail.textContent = "Setting up microphone and connection";
        break;

      case "listening":
        voiceIndicator.classList.add("listening");
        voiceStatusText.textContent = "Listening";
        voiceStatusDetail.textContent = "Speak to start conversation";
        break;

      case "speaking":
        voiceIndicator.classList.add("speaking");
        volumeBar.classList.add("speaking");
        voiceStatusText.textContent = "Recording";
        voiceStatusDetail.textContent = "Capturing your speech...";
        break;

      case "processing":
        voiceIndicator.classList.add("processing");
        voiceStatusText.textContent = "Processing";
        voiceStatusDetail.textContent = "Waiting for response...";
        break;

      case "agent_speaking":
        voiceStatusText.textContent = "Agent Speaking";
        voiceStatusDetail.textContent = `Agent ${status.agentId || ""} is responding`;
        break;

      case "paused":
        voiceStatusText.textContent = "Paused";
        voiceStatusDetail.textContent = "Voice capture paused";
        break;

      case "stopped":
        voiceStatusText.textContent = "Stopped";
        voiceStatusDetail.textContent = "Voice session ended";
        break;

      case "error":
        voiceIndicator.classList.add("error");
        voiceStatusText.textContent = "Error";
        voiceStatusDetail.textContent = status.message || "An error occurred";
        break;

      case "transcript":
        voiceStatusDetail.textContent = `"${status.text}"`;
        break;
    }
  }

  function handleVolumeChange(volume) {
    // volume is 0-1
    volumeBar.style.width = `${volume * 100}%`;
  }

  function handleSpeechStart() {
    console.log("Speech started - interrupting agents");

    // Stop all audio immediately when user starts speaking
    stopAllAudio();

    agentResponse.classList.remove("visible");
  }

  function handleSpeechEnd() {
    console.log("Speech ended");
  }

  function handleVoiceError(error) {
    console.error("Voice error:", error);

    // Extract error message properly
    let errorMessage = "Unknown error occurred";

    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === "string") {
      errorMessage = error;
    } else if (error && error.message) {
      errorMessage = error.message;
    } else if (error && error.name) {
      errorMessage = error.name;
    }

    // Check if it's a permission error
    const isPermissionError =
      errorMessage.toLowerCase().includes("denied") ||
      errorMessage.toLowerCase().includes("permission") ||
      errorMessage.toLowerCase().includes("allowed");

    // Show permission help if relevant
    const micPermissionHelp = document.getElementById("micPermissionHelp");
    if (micPermissionHelp) {
      micPermissionHelp.style.display = isPermissionError ? "block" : "none";
    }

    // Show user-friendly status
    setStatus("error", errorMessage);

    // Update voice UI to show error state
    handleVoiceStatusChange({ status: "error", message: errorMessage });

    // Reset buttons so user can try again
    stopVoiceBtn.style.display = "none";
    startVoiceBtn.style.display = "block";
    startVoiceBtn.disabled = false;
    connectionDot.classList.remove("connecting");
  }

  function handleAgentResponse(response) {
    console.log("Agent response:", response);

    agentName.textContent = response.agentId || "Agent";
    agentText.textContent = response.text;
    agentResponse.classList.add("visible");

    // If audio is provided, play it (will be queued)
    if (response.audio) {
      playAudioResponse(response.audio, response.agentId || "Agent");
    }
  }

  function handleConnectionChange(state) {
    connectionDot.classList.remove("connecting", "connected");

    if (state.connected) {
      connectionDot.classList.add("connected");
    }
  }

  // ==================== Audio Playback ====================

  // Stop all audio playback immediately
  function stopAllAudio() {
    console.log("Stopping all audio playback");

    // Clear the queue
    audioQueue = [];

    // Stop current audio if playing
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }

    isPlayingAudio = false;

    // Resume voice capture immediately
    if (voiceCapture) {
      voiceCapture.resume();
    }
  }

  // Add audio to queue and play if not already playing
  function playAudioResponse(base64Audio, agentName) {
    try {
      // Decode base64 to audio
      const audioData = atob(base64Audio);
      const arrayBuffer = new ArrayBuffer(audioData.length);
      const view = new Uint8Array(arrayBuffer);

      for (let i = 0; i < audioData.length; i++) {
        view[i] = audioData.charCodeAt(i);
      }

      // Create audio blob
      const blob = new Blob([arrayBuffer], { type: "audio/mp3" });
      const audioUrl = URL.createObjectURL(blob);

      // Add to queue
      audioQueue.push({ audioUrl, agentName });
      console.log(
        `Added ${agentName} audio to queue (queue length: ${audioQueue.length})`,
      );

      // Start playing if not already playing
      if (!isPlayingAudio) {
        playNextInQueue();
      }
    } catch (error) {
      console.error("Failed to prepare audio:", error);
    }
  }

  // Play next audio in queue
  function playNextInQueue() {
    if (audioQueue.length === 0) {
      isPlayingAudio = false;
      console.log("Audio queue empty, resuming voice capture");

      // Resume voice capture when queue is empty
      if (voiceCapture) {
        voiceCapture.resume();
      }
      return;
    }

    const { audioUrl, agentName } = audioQueue.shift();
    isPlayingAudio = true;

    console.log(
      `Playing ${agentName} audio (${audioQueue.length} remaining in queue)`,
    );

    // Pause voice capture while playing
    if (voiceCapture) {
      voiceCapture.pause();
    }

    // Create and play audio
    currentAudio = new Audio(audioUrl);

    currentAudio.onended = () => {
      console.log(`${agentName} audio finished`);
      URL.revokeObjectURL(audioUrl);
      currentAudio = null;

      // Play next in queue
      playNextInQueue();
    };

    currentAudio.onerror = (error) => {
      console.error(`Audio playback error for ${agentName}:`, error);
      URL.revokeObjectURL(audioUrl);
      currentAudio = null;

      // Continue to next in queue even on error
      playNextInQueue();
    };

    currentAudio.play().catch((error) => {
      console.error(`Failed to play ${agentName} audio:`, error);
      URL.revokeObjectURL(audioUrl);
      currentAudio = null;
      playNextInQueue();
    });
  }

  // ==================== Helper Functions ====================

  function extractDocumentId(url) {
    const match = url.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
  }

  function extractTextFromDocument(doc) {
    if (!doc.body || !doc.body.content) {
      return "";
    }

    let text = "";

    function extractFromStructuralElement(element) {
      if (element.paragraph) {
        const paragraph = element.paragraph;
        if (paragraph.elements) {
          for (const elem of paragraph.elements) {
            if (elem.textRun && elem.textRun.content) {
              text += elem.textRun.content;
            }
          }
        }
      } else if (element.table) {
        const table = element.table;
        if (table.tableRows) {
          for (const row of table.tableRows) {
            if (row.tableCells) {
              for (const cell of row.tableCells) {
                if (cell.content) {
                  for (const cellElement of cell.content) {
                    extractFromStructuralElement(cellElement);
                  }
                }
              }
            }
          }
        }
      } else if (element.tableOfContents) {
        const toc = element.tableOfContents;
        if (toc.content) {
          for (const tocElement of toc.content) {
            extractFromStructuralElement(tocElement);
          }
        }
      }
    }

    for (const element of doc.body.content) {
      extractFromStructuralElement(element);
    }

    return text;
  }

  function updateWordCount(text) {
    const words = text
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0);
    wordCountDiv.textContent = `${words.length} words, ${text.length} characters`;
  }

  /**
   * Send document to backend and create a session
   * Returns: { documentId: uuid, sessionId: uuid }
   */
  /**
   * Send document to backend and create a session
   * Matches schema: documents(id, created_at, doc_text), sessions(id, user_id, document_id, created_at)
   */
  async function sendToBackend(googleDocId, title, content, documentUrl) {
    try {
      // Step 1: Create document (only doc_text needed, id and created_at are auto-generated)
      const docResponse = await fetch(`${BACKEND_URL}/api/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_text: content }),
      });

      if (!docResponse.ok) {
        console.error("Backend error (document):", docResponse.status);
        return null;
      }

      const docData = await docResponse.json();
      console.log("Document created:", docData);

      // Step 2: Create session linking user to document
      const userId = generateUserId();
      const sessionResponse = await fetch(`${BACKEND_URL}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          document_id: docData.id,
        }),
      });

      if (!sessionResponse.ok) {
        console.error("Backend error (session):", sessionResponse.status);
        return { documentId: docData.id, sessionId: null, userId: userId };
      }

      const sessionData = await sessionResponse.json();
      console.log("Session created:", sessionData);

      return {
        documentId: docData.id,
        sessionId: sessionData.id,
        userId: userId,
      };
    } catch (error) {
      console.error("Failed to send to backend:", error);
      return null;
    }
  }

  function generateUserId() {
    // Try to get from storage or generate new
    let userId = localStorage.getItem("voice_user_id");
    if (!userId) {
      userId = "user_" + Math.random().toString(36).substring(2, 15);
      localStorage.setItem("voice_user_id", userId);
    }
    return userId;
  }

  function generateSessionId() {
    return (
      "session_" +
      Math.random().toString(36).substring(2, 15) +
      "_" +
      Date.now()
    );
  }

  function setStatus(type, message) {
    statusDiv.className = `status ${type}`;
    statusDiv.textContent = message;
  }

  function showSignedInState() {
    signInBtn.style.display = "none";
    extractBtn.style.display = "block";
    signOutBtn.style.display = "block";
  }

  function showSignedOutState() {
    signInBtn.style.display = "block";
    extractBtn.style.display = "none";
    signOutBtn.style.display = "none";
    contentArea.style.display = "none";
    voiceSection.style.display = "none";
    accessToken = null;

    // Reset voice UI
    if (voiceCapture) {
      voiceCapture.stop();
      voiceCapture = null;
    }
    resetVoiceUI();
  }

  function resetVoiceUI() {
    voiceIndicator.classList.remove(
      "listening",
      "speaking",
      "processing",
      "error",
    );
    volumeBar.classList.remove("speaking");
    volumeBar.style.width = "0%";
    voiceStatusText.textContent = "Ready to start";
    voiceStatusDetail.textContent = 'Click "Start Voice" to begin conversation';
    connectionDot.classList.remove("connecting", "connected");
    agentResponse.classList.remove("visible");
    sessionIdDisplay.textContent = "-";
    userIdDisplay.textContent = "-";

    // Hide permission help
    const micPermissionHelp = document.getElementById("micPermissionHelp");
    if (micPermissionHelp) {
      micPermissionHelp.style.display = "none";
    }
  }

  // ==================== Initialize ====================

  await checkAuthStatus();
});
