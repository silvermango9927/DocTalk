document.addEventListener("DOMContentLoaded", async () => {
  // ==================== DOM ELEMENTS ====================
  
  const signInBtn = document.getElementById("signInBtn");
  const signOutBtn = document.getElementById("signOutBtn");
  const signOutBtn2 = document.getElementById("signOutBtn2");
  const statusDiv = document.getElementById("status");
  const signInState = document.getElementById("signInState");
  const noDocState = document.getElementById("noDocState");
  const voiceSection = document.getElementById("voiceSection");
  
  // Voice elements
  const startVoiceBtn = document.getElementById("startVoiceBtn");
  const stopVoiceBtn = document.getElementById("stopVoiceBtn");
  const volumeBar = document.getElementById("volumeBar");
  const micPermissionHelp = document.getElementById("micPermissionHelp");
  const transcriptBox = document.getElementById("transcriptBox");
  const userIndicator = document.getElementById("userIndicator");
  const userStatusText = document.getElementById("userStatusText");

  // Orb elements
  const criticOrb = document.getElementById("criticOrb");
  const creativeOrb = document.getElementById("creativeOrb");

  // ==================== STATE ====================
  
  let accessToken = null;
  let extractedText = "";
  let voiceCapture = null;
  let currentDocumentId = null;
  let currentSessionId = null;
  let currentUserId = null;
  let audioQueue = [];
  let currentAudio = null;
  let isPlayingAudio = false;
  let transcriptHistory = [];

  // ==================== CONFIG ====================
  
  const BACKEND_URL = "https://doctalk-0mxw.onrender.com";
  const WS_URL = "https://doctalk-0mxw.onrender.com/ws/voice";

  // ==================== INITIALIZATION ====================

  async function initialize() {
    const token = await getAuthToken(false);
    
    if (token) {
      accessToken = token;
      await checkCurrentTab();
    } else {
      showSignInState();
    }
  }

  async function checkCurrentTab() {
    setStatus("loading", "Checking document...");
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      console.error(tab.url);
      
      if (!tab.url || !tab.url.includes("docs.google.com/document") && !tab.url.includes("docs.google.com/spreadsheets")) {
        console.error("No valid Google Doc or Sheet open");
        showNoDocState();
        return;
      }

      // Auto-extract the document
      await extractDocument(tab);
    } catch (error) {
      console.error("Tab check error:", error);
      showNoDocState();
    }
  }

  async function extractDocument(tab) {
    setStatus("loading", "Reading document...");

    try {
      /*const docId = extractDocumentId(tab.url);
      if (!docId) {
        setStatus("error", "Could not read document");
        showNoDocState();
        return;
      }*/

      if (tab.url && tab.url.includes("/document/")) {
        const docId = extractDocumentId(tab.url);
        if (!docId) { 
          setStatus("error", "Could not read document");
          showNoDocState();
          return;
        }
  
        const response = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
  
        const data = await response.json();
        extractedText = extractTextFromDocument(data);
        // same backend send flow...

        if (extractedText.trim().length === 0) {
          setStatus("error", "Document is empty");
          showNoDocState();
          return;
        }
  
        // Send to backend silently
        const backendData = await sendToBackend(docId, data.title, extractedText, tab.url);
        if (backendData) {
          currentDocumentId = backendData.documentId;
          currentSessionId = backendData.sessionId;
          currentUserId = backendData.userId;
        }
  
        // Show voice interface
        setStatus("success", "Ready to talk about your document");
        showVoiceSection();
      }

      

      else if (tab.url && tab.url.includes("/spreadsheets/")) {
        const sheetId = extractSpreadsheetId(tab.url);
        if (!sheetId) {
          setStatus("error", "Could not read spreadsheet");
          showNoDocState();
          return;
        }
  
        const sheetText = await extractSheetText(sheetId);
        extractedText = sheetText;
  
        if (extractedText.trim().length === 0) {
          setStatus("error", "Spreadsheet is empty or not accessible");
          showNoDocState();
          return;
        }
  
        // reuse sendToBackend to create a document record
        const backendData = await sendToBackend(sheetId, "Spreadsheet", extractedText, tab.url);
        if (backendData) {
          currentDocumentId = backendData.documentId;
          currentSessionId = backendData.sessionId;
          currentUserId = backendData.userId;
        }
  
        setStatus("success", "Ready to talk about your spreadsheet");
        showVoiceSection();
      }

      else {
        showNoDocState();
        return;
      }

    } catch (error) {
      console.error("Extraction error:", error);
      setStatus("error", "Something went wrong");
      showNoDocState();
    }
  }

  // ==================== UI STATE MANAGEMENT ====================

  function showSignInState() {
    signInState.classList.remove("hidden");
    noDocState.classList.add("hidden");
    voiceSection.classList.add("hidden");
    setStatus("info", "Sign in to get started");
  }

  function showNoDocState() {
    signInState.classList.add("hidden");
    noDocState.classList.remove("hidden");
    voiceSection.classList.add("hidden");
    setStatus("info", "Open a Google Doc to chat");
  }

  function showVoiceSection() {
    signInState.classList.add("hidden");
    noDocState.classList.add("hidden");
    voiceSection.classList.remove("hidden");
  }

  // ==================== DRAGGABLE ORBS ====================
  
  function initDraggableOrbs() {
    const arena = document.querySelector(".orbs-arena");
    const orbs = [criticOrb, creativeOrb];

    orbs.forEach(orbWrapper => {
      let isDragging = false;
      let startX, startY;
      let initialLeft, initialTop;

      const onMouseDown = (e) => {
        if (e.target.closest(".orb-label")) return;
        
        isDragging = true;
        orbWrapper.classList.add("dragging");
        
        const rect = orbWrapper.getBoundingClientRect();
        const arenaRect = arena.getBoundingClientRect();
        
        startX = e.clientX || e.touches?.[0]?.clientX;
        startY = e.clientY || e.touches?.[0]?.clientY;
        
        const computedStyle = window.getComputedStyle(orbWrapper);
        initialLeft = parseFloat(computedStyle.left) || rect.left - arenaRect.left + rect.width / 2;
        initialTop = parseFloat(computedStyle.top) || rect.top - arenaRect.top + rect.height / 2;
        
        e.preventDefault();
      };

      const onMouseMove = (e) => {
        if (!isDragging) return;
        
        const clientX = e.clientX || e.touches?.[0]?.clientX;
        const clientY = e.clientY || e.touches?.[0]?.clientY;
        
        const deltaX = clientX - startX;
        const deltaY = clientY - startY;
        
        const arenaRect = arena.getBoundingClientRect();
        
        let newLeft = initialLeft + deltaX;
        let newTop = initialTop + deltaY;
        
        const padding = 40;
        newLeft = Math.max(padding, Math.min(arenaRect.width - padding, newLeft));
        newTop = Math.max(padding, Math.min(arenaRect.height - padding, newTop));
        
        const leftPercent = (newLeft / arenaRect.width) * 100;
        const topPercent = (newTop / arenaRect.height) * 100;
        
        orbWrapper.style.left = `${leftPercent}%`;
        orbWrapper.style.top = `${topPercent}%`;
        orbWrapper.style.transform = "translate(-50%, -50%)";
      };

      const onMouseUp = () => {
        if (!isDragging) return;
        isDragging = false;
        orbWrapper.classList.remove("dragging");
      };

      orbWrapper.addEventListener("mousedown", onMouseDown);
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);

      orbWrapper.addEventListener("touchstart", onMouseDown, { passive: false });
      document.addEventListener("touchmove", onMouseMove, { passive: false });
      document.addEventListener("touchend", onMouseUp);
    });
  }

  // ==================== ORB STATE MANAGEMENT ====================

  function setUserSpeaking(isSpeaking) {
    if (isSpeaking) {
      criticOrb.classList.add("user-speaking");
      creativeOrb.classList.add("user-speaking");
      criticOrb.classList.remove("speaking");
      creativeOrb.classList.remove("speaking");
      userIndicator.classList.add("recording");
      userIndicator.classList.remove("listening");
      userStatusText.textContent = "Speaking";
    } else {
      criticOrb.classList.remove("user-speaking");
      creativeOrb.classList.remove("user-speaking");
      userIndicator.classList.remove("recording");
    }
  }

  function setListening() {
    criticOrb.classList.remove("speaking", "user-speaking");
    creativeOrb.classList.remove("speaking", "user-speaking");
    userIndicator.classList.add("listening");
    userIndicator.classList.remove("recording");
    userStatusText.textContent = "Listening";
  }

  function resetOrbStates() {
    criticOrb.classList.remove("speaking", "user-speaking");
    creativeOrb.classList.remove("speaking", "user-speaking");
    userIndicator.classList.remove("listening", "recording");
    userStatusText.textContent = "Ready";
  }

  // ==================== TRANSCRIPT MANAGEMENT ====================
  
  function addTranscript(speaker, text) {
    transcriptHistory.push({ speaker, text, timestamp: Date.now() });
    
    if (transcriptHistory.length > 10) {
      transcriptHistory.shift();
    }
    
    renderTranscript();
  }

  function renderTranscript() {
    if (transcriptHistory.length === 0) {
      transcriptBox.innerHTML = '<div class="transcript-empty">Start talking to discuss your document...</div>';
      return;
    }
    
    transcriptBox.innerHTML = transcriptHistory.map(item => {
      const speakerClass = item.speaker.toLowerCase().includes("critic") ? "critic" :
                          item.speaker.toLowerCase().includes("creative") ? "creative" :
                          item.speaker === "user" ? "user" : "";
      const displayName = item.speaker === "user" ? "You" : item.speaker;
      
      return `
        <div class="transcript-item">
          <span class="speaker ${speakerClass}">${displayName}:</span>
          ${escapeHtml(item.text)}
        </div>
      `;
    }).join("");
    
    transcriptBox.scrollTop = transcriptBox.scrollHeight;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // ==================== AUTH FUNCTIONS ====================

  async function getAuthToken(interactive = false) {
    return new Promise((resolve) => {
      chrome.identity.getAuthToken({ interactive }, (token) => {
        if (chrome.runtime.lastError || !token) {
          resolve(null);
        } else {
          resolve(token);
        }
      });
    });
  }

  async function signOut() {
    if (voiceCapture) {
      voiceCapture.stop();
      voiceCapture = null;
    }

    if (accessToken) {
      await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${accessToken}`);
      chrome.identity.removeCachedAuthToken({ token: accessToken }, () => {
        accessToken = null;
        showSignInState();
      });
    }
  }

  // ==================== EVENT LISTENERS ====================

  signInBtn.addEventListener("click", async () => {
    signInBtn.disabled = true;
    setStatus("loading", "Signing in...");

    const token = await getAuthToken(true);
    if (token) {
      accessToken = token;
      await checkCurrentTab();
    } else {
      setStatus("error", "Could not sign in");
      signInBtn.disabled = false;
    }
  });

  signOutBtn.addEventListener("click", signOut);
  signOutBtn2.addEventListener("click", signOut);

  // ==================== VOICE EVENT LISTENERS ====================

  startVoiceBtn.addEventListener("click", async () => {
    startVoiceBtn.disabled = true;
    setStatus("loading", "Starting microphone...");

    try {
      const userId = currentUserId || generateUserId();
      const sessionId = currentSessionId || generateSessionId();

      voiceCapture = new VoiceCapture({
        wsUrl: WS_URL,
        userId: userId,
        sessionId: sessionId,
        documentId: currentDocumentId,
        docText: extractedText,
        speechThreshold: 0.12,
        silenceDuration: 800,

        onStatusChange: handleVoiceStatusChange,
        onVolumeChange: handleVolumeChange,
        onSpeechStart: handleSpeechStart,
        onSpeechEnd: handleSpeechEnd,
        onError: handleVoiceError,
        onAgentResponse: handleAgentResponse,
        onConnectionChange: handleConnectionChange,
        onInterrupt: stopAllAudio,
      });

      const started = await voiceCapture.start();

      if (started) {
        startVoiceBtn.classList.add("hidden");
        stopVoiceBtn.classList.remove("hidden");
        setStatus("success", "Listening...");
        micPermissionHelp.classList.add("hidden");
        setListening();
      } else {
        throw new Error("Failed to start");
      }
    } catch (error) {
      console.error("Voice start error:", error);
      if (voiceCapture) {
        voiceCapture.stop();
        voiceCapture = null;
      }
      handleVoiceError(error);
    }
  });

  stopVoiceBtn.addEventListener("click", () => {
    if (voiceCapture) {
      voiceCapture.stop();
      voiceCapture = null;
    }

    stopVoiceBtn.classList.add("hidden");
    startVoiceBtn.classList.remove("hidden");
    startVoiceBtn.disabled = false;

    resetVoiceUI();
    setStatus("success", "Ready to talk about your document");
  });

  // ==================== VOICE HANDLERS ====================

  function handleVoiceStatusChange(status) {
    switch (status.status) {
      case "initializing":
        userStatusText.textContent = "Starting...";
        break;
      case "listening":
        setListening();
        break;
      case "speaking":
        setUserSpeaking(true);
        break;
      case "processing":
        userStatusText.textContent = "Processing...";
        userIndicator.classList.remove("listening", "recording");
        break;
      case "agent_speaking":
        userStatusText.textContent = "Agent speaking";
        break;
      case "paused":
        userStatusText.textContent = "Paused";
        break;
      case "stopped":
        resetOrbStates();
        userStatusText.textContent = "Stopped";
        break;
      case "error":
        resetOrbStates();
        userStatusText.textContent = "Error";
        break;
      case "transcript":
        if (status.text) {
          addTranscript("user", status.text);
        }
        break;
    }
  }

  function handleVolumeChange(volume) {
    volumeBar.style.width = `${volume * 100}%`;
  }

  function handleSpeechStart() {
    stopAllAudio();
    setUserSpeaking(true);
  }

  function handleSpeechEnd() {
    setUserSpeaking(false);
  }

  function handleVoiceError(error) {
    let errorMessage = "Something went wrong";
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === "string") {
      errorMessage = error;
    } else if (error?.message) {
      errorMessage = error.message;
    }

    const isPermissionError = errorMessage.toLowerCase().includes("denied") ||
                              errorMessage.toLowerCase().includes("permission");

    micPermissionHelp.classList.toggle("hidden", !isPermissionError);
    setStatus("error", isPermissionError ? "Microphone access needed" : errorMessage);

    stopVoiceBtn.classList.add("hidden");
    startVoiceBtn.classList.remove("hidden");
    startVoiceBtn.disabled = false;
    resetOrbStates();
  }

  function handleAgentResponse(response) {
    const agentId = response.agentId || "Agent";
    addTranscript(agentId, response.text);

    if (response.audio) {
      playAudioResponse(response.audio, agentId);
    }
  }

  function handleConnectionChange(state) {
    // Connection state changed
  }

  // ==================== AUDIO PLAYBACK ====================

  function stopAllAudio() {
    audioQueue = [];
    
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }

    isPlayingAudio = false;
    resetOrbStates();
    setListening();

    if (voiceCapture) {
      voiceCapture.resume();
    }
  }

  function playAudioResponse(base64Audio, agentName) {
    try {
      const audioData = atob(base64Audio);
      const arrayBuffer = new ArrayBuffer(audioData.length);
      const view = new Uint8Array(arrayBuffer);

      for (let i = 0; i < audioData.length; i++) {
        view[i] = audioData.charCodeAt(i);
      }

      const blob = new Blob([arrayBuffer], { type: "audio/mp3" });
      const audioUrl = URL.createObjectURL(blob);

      audioQueue.push({ audioUrl, agentName });

      if (!isPlayingAudio) {
        playNextInQueue();
      }
    } catch (error) {
      console.error("Audio prep failed:", error);
    }
  }

  function playNextInQueue() {
    if (audioQueue.length === 0) {
      isPlayingAudio = false;
      setListening();

      if (voiceCapture) {
        voiceCapture.resume();
      }
      return;
    }

    const { audioUrl, agentName } = audioQueue.shift();
    isPlayingAudio = true;

    if (voiceCapture) {
      voiceCapture.pause();
    }

    currentAudio = new Audio(audioUrl);

    currentAudio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      currentAudio = null;
      playNextInQueue();
    };

    currentAudio.onerror = () => {
      URL.revokeObjectURL(audioUrl);
      currentAudio = null;
      playNextInQueue();
    };

    currentAudio.play().catch(() => {
      URL.revokeObjectURL(audioUrl);
      currentAudio = null;
      playNextInQueue();
    });
  }

  // ==================== HELPER FUNCTIONS ====================

  function extractDocumentId(url) {
    const match = url.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
  }

  function extractSpreadsheetId(url) {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
  }

  function extractTextFromDocument(doc) {
    if (!doc.body?.content) return "";

    let text = "";

    function extractFromElement(element) {
      if (element.paragraph?.elements) {
        for (const elem of element.paragraph.elements) {
          if (elem.textRun?.content) {
            text += elem.textRun.content;
          }
        }
      } else if (element.table?.tableRows) {
        for (const row of element.table.tableRows) {
          for (const cell of row.tableCells || []) {
            for (const cellElement of cell.content || []) {
              extractFromElement(cellElement);
            }
          }
        }
      } else if (element.tableOfContents?.content) {
        for (const tocElement of element.tableOfContents.content) {
          extractFromElement(tocElement);
        }
      }
    }

    for (const element of doc.body.content) {
      extractFromElement(element);
    }

    return text;
  }

  async function extractSheetText(spreadsheetId) {
    // Use the same accessToken as for Docs
    if (!accessToken) return "";
  
    // includeGridData gives us rows; fallback to values endpoint if you prefer smaller payloads
    const resp = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?includeGridData=true`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
  
    if (!resp.ok) {
      console.warn("Sheets API access failed", resp.status);
      return "";
    }
  
    const sheetData = await resp.json();

    console.error(sheetData.sheets);
  
    // Flatten to plain text: sheet name, then rows joined by tabs/newlines
    const parts = [];
    for (const sheet of sheetData.sheets || []) {
      const title = sheet.properties?.title || "Sheet";
      parts.push(`--- ${title} ---`);
      const rows = sheet.data?.[0]?.rowData || [];
      for (const r of rows) {
        const values = (r.values || []).map(c => {
          if (!c) return "";
          if (c.effectiveValue?.stringValue) return c.effectiveValue.stringValue;
          if (c.effectiveValue?.numberValue) return String(c.effectiveValue.numberValue);
          return c.formattedValue || "";
        });
        parts.push(values.join("\t"));
      }
    }
    return parts.join("\n");
  }

  async function sendToBackend(googleDocId, title, content, documentUrl) {
    try {
      const docResponse = await fetch(`${BACKEND_URL}/api/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_text: content })
      });

      if (!docResponse.ok) return null;

      const docData = await docResponse.json();

      const userId = generateUserId();
      const sessionResponse = await fetch(`${BACKEND_URL}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, document_id: docData.id })
      });

      if (!sessionResponse.ok) {
        return { documentId: docData.id, sessionId: null, userId };
      }

      const sessionData = await sessionResponse.json();

      return { documentId: docData.id, sessionId: sessionData.id, userId };
    } catch (error) {
      console.error("Backend error:", error);
      return null;
    }
  }

  function generateUserId() {
    let userId = localStorage.getItem("voice_user_id");
    if (!userId) {
      userId = "user_" + Math.random().toString(36).substring(2, 15);
      localStorage.setItem("voice_user_id", userId);
    }
    return userId;
  }

  function generateSessionId() {
    return "session_" + Math.random().toString(36).substring(2, 15) + "_" + Date.now();
  }

  function setStatus(type, message) {
    statusDiv.className = `status-badge ${type}`;
    statusDiv.innerHTML = `<span class="dot"></span><span class="text">${message}</span>`;
  }

  function resetVoiceUI() {
    resetOrbStates();
    volumeBar.style.width = "0%";
    micPermissionHelp.classList.add("hidden");
    transcriptHistory = [];
    renderTranscript();
  }

  // ==================== INITIALIZE ====================

  initDraggableOrbs();
  await initialize();
});