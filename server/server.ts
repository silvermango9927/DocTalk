/**
 * Talk With Doc - Voice AI Server
 * 
 * Connects Chrome extension to LangGraph multi-agent system
 * with GPT-4o-audio-preview for direct audio responses.
 */

import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

// AI imports
import { streamAgent, AudioCallback } from "./ai/index";
import { AudioOutput } from "./ai/state";
import { speechToText } from "./stt";

dotenv.config();

// ==================== Supabase Setup ====================

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY in environment variables");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ==================== Express Setup ====================

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/voice" });

// ==================== Types ====================

interface Document {
  id: string;
  created_at: string;
  doc_text: string;
}

interface Session {
  id: string;
  user_id: string;
  document_id: string;
  created_at: string;
}

interface Message {
  id: string;
  document_id: string;
  created_at: string;
  sender: string;
  text: string;
}

// ==================== REST API Endpoints ====================

app.get("/health", async (req, res) => {
  // Test Supabase connection
  const { error } = await supabase.from("documents").select("id").limit(1);
  res.json({ 
    status: error ? "degraded" : "ok", 
    database: error ? "disconnected" : "connected",
    timestamp: new Date().toISOString() 
  });
});

/**
 * POST /api/documents
 * Create a new document
 */
app.post("/api/documents", async (req, res) => {
  try {
    const { doc_text } = req.body;

    if (!doc_text) {
      return res.status(400).json({ error: "doc_text is required" });
    }

    const { data, error } = await supabase
      .from("documents")
      .insert({ doc_text })
      .select()
      .single();

    if (error) {
      console.error("[API] Supabase error:", error);
      return res.status(500).json({ error: error.message });
    }

    console.log(`[API] Document created: ${data.id} (${doc_text.length} chars)`);
    res.json(data);
  } catch (error) {
    console.error("[API] Error creating document:", error);
    res.status(500).json({ error: "Failed to create document" });
  }
});

/**
 * GET /api/documents/:id
 */
app.get("/api/documents/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("documents")
      .select()
      .eq("id", req.params.id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Document not found" });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to get document" });
  }
});

/**
 * POST /api/sessions
 * Create a new session linking user to document
 */
app.post("/api/sessions", async (req, res) => {
  try {
    const { user_id, document_id } = req.body;

    if (!user_id || !document_id) {
      return res.status(400).json({ error: "user_id and document_id are required" });
    }

    const { data, error } = await supabase
      .from("sessions")
      .insert({ user_id, document_id })
      .select()
      .single();

    if (error) {
      console.error("[API] Supabase error:", error);
      return res.status(500).json({ error: error.message });
    }

    console.log(`[API] Session created: ${data.id} for document: ${document_id}`);
    res.json(data);
  } catch (error) {
    console.error("[API] Error creating session:", error);
    res.status(500).json({ error: "Failed to create session" });
  }
});

/**
 * GET /api/sessions/:id/messages
 */
app.get("/api/sessions/:id/messages", async (req, res) => {
  try {
    // First get the session to find the document_id
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select()
      .eq("id", req.params.id)
      .single();

    if (sessionError || !session) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Then get messages for that document
    const { data: messages, error: messagesError } = await supabase
      .from("messages")
      .select()
      .eq("document_id", session.document_id)
      .order("created_at", { ascending: true });

    if (messagesError) {
      return res.status(500).json({ error: messagesError.message });
    }

    res.json(messages || []);
  } catch (error) {
    res.status(500).json({ error: "Failed to get messages" });
  }
});

// ==================== WebSocket Handler ====================

interface AudioChunk {
  data: string;
  sequence: number;
  sampleRate: number;
  timestamp: number;
}

interface ConnectionData {
  visitorId: string;
  sessionId: string | null;
  documentId: string | null;
  userId: string | null;
  docText: string | null;
  audioBuffer: AudioChunk[];
  interruptSignal: { interrupted: boolean };
}

const connections = new Map<string, ConnectionData>();

wss.on("connection", (ws: WebSocket, req) => {
  console.log("[WS] New connection");

  const connectionData: ConnectionData = {
    visitorId: uuidv4(),
    sessionId: null,
    documentId: null,
    userId: null,
    docText: null,
    audioBuffer: [],
    interruptSignal: { interrupted: false },
  };

  connections.set(connectionData.visitorId, connectionData);

  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        // ============ CONNECTION INIT ============
        case "connection_init": {
          connectionData.sessionId = message.sessionId;
          connectionData.documentId = message.documentId;
          connectionData.userId = message.userId;

          // Load document text from Supabase if we have a documentId
          if (message.documentId) {
            const { data: doc, error } = await supabase
              .from("documents")
              .select("doc_text")
              .eq("id", message.documentId)
              .single();

            if (doc && !error) {
              connectionData.docText = doc.doc_text;
              console.log(`[WS] Loaded document: ${message.documentId} (${doc.doc_text.length} chars)`);
            } else {
              console.warn(`[WS] Could not load document: ${message.documentId}`, error);
            }
          }

          console.log(`[WS] Connection init: user=${message.userId}, session=${message.sessionId}`);

          ws.send(
            JSON.stringify({
              type: "connection_ack",
              visitorId: connectionData.visitorId,
              timestamp: Date.now(),
            })
          );
          break;
        }

        // ============ SPEECH START ============
        case "speech_start": {
          console.log(`[WS] Speech started: user=${message.userId}`);

          // Interrupt any ongoing agent response
          connectionData.interruptSignal.interrupted = true;

          // Reset for new utterance
          connectionData.audioBuffer = [];
          connectionData.interruptSignal = { interrupted: false };

          // Tell client to stop playing current audio
          ws.send(
            JSON.stringify({
              type: "interrupt",
              timestamp: Date.now(),
            })
          );
          break;
        }

        // ============ AUDIO CHUNK ============
        case "audio_chunk": {
          connectionData.audioBuffer.push({
            data: message.data,
            sequence: message.sequence,
            sampleRate: message.sampleRate,
            timestamp: message.timestamp,
          });
          break;
        }

        // ============ SPEECH END ============
        case "speech_end": {
          console.log(`[WS] Speech ended: ${connectionData.audioBuffer.length} chunks, ${message.duration}ms`);

          if (connectionData.audioBuffer.length === 0) {
            console.log("[WS] No audio to process");
            break;
          }

          try {
            // 1. Speech-to-Text
            const transcript = await speechToText(connectionData.audioBuffer);

            if (!transcript || transcript.trim().length === 0) {
              console.log("[WS] Empty transcript, skipping");
              ws.send(
                JSON.stringify({
                  type: "transcript",
                  text: "",
                  timestamp: Date.now(),
                })
              );
              break;
            }

            // 2. Save user message to Supabase
            await saveMessage({
              document_id: connectionData.documentId!,
              sender: "user",
              text: transcript,
            });

            // 3. Send transcript to client
            ws.send(
              JSON.stringify({
                type: "transcript",
                text: transcript,
                timestamp: Date.now(),
              })
            );

            // 4. Stream agent responses
            const onAudio: AudioCallback = async (audio: AudioOutput) => {
              // Check if interrupted
              if (connectionData.interruptSignal.interrupted) {
                console.log("[WS] Response interrupted, stopping");
                return;
              }

              // Send audio to client
              ws.send(
                JSON.stringify({
                  type: "agent_response",
                  agentId: audio.agentName,
                  text: audio.transcript,
                  audio: audio.audioData,
                  timestamp: Date.now(),
                })
              );

              // Save agent message to Supabase
              await saveMessage({
                document_id: connectionData.documentId!,
                sender: audio.agentName,
                text: audio.transcript,
              });

              console.log(`[WS] Sent ${audio.agentName} response: "${audio.transcript.substring(0, 50)}..."`);
            };

            // 5. Run the LangGraph agents
            console.log("[WS] Starting agent graph...");
            await streamAgent(
              transcript,
              connectionData.docText || "",
              connectionData.sessionId || "default",
              onAudio,
              connectionData.interruptSignal
            );

            console.log("[WS] Agent graph complete");

          } catch (error) {
            console.error("[WS] Error processing speech:", error);
            ws.send(
              JSON.stringify({
                type: "error",
                message: error instanceof Error ? error.message : "Processing failed",
                timestamp: Date.now(),
              })
            );
          }

          // Clear buffer
          connectionData.audioBuffer = [];
          break;
        }

        // ============ DISCONNECT ============
        case "disconnect": {
          console.log(`[WS] Disconnecting: user=${message.userId}`);
          connections.delete(connectionData.visitorId);
          break;
        }

        default:
          console.log(`[WS] Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error("[WS] Error handling message:", error);
      ws.send(
        JSON.stringify({
          type: "error",
          message: error instanceof Error ? error.message : "Unknown error",
          timestamp: Date.now(),
        })
      );
    }
  });

  ws.on("close", () => {
    console.log(`[WS] Connection closed: ${connectionData.visitorId}`);
    connections.delete(connectionData.visitorId);
  });

  ws.on("error", (error) => {
    console.error(`[WS] Connection error: ${connectionData.visitorId}`, error);
    connections.delete(connectionData.visitorId);
  });
});

// ==================== Helper Functions ====================

async function saveMessage(params: {
  document_id: string;
  sender: string;
  text: string;
}): Promise<Message | null> {
  const { data, error } = await supabase
    .from("messages")
    .insert({
      document_id: params.document_id,
      sender: params.sender,
      text: params.text,
    })
    .select()
    .single();

  if (error) {
    console.error("[DB] Error saving message:", error);
    return null;
  }

  console.log(`[DB] Message saved: ${params.sender} -> "${params.text.substring(0, 50)}..."`);
  return data;
}

/**
 * Load conversation history for a document (for context)
 */
async function getConversationHistory(documentId: string, limit = 20): Promise<Message[]> {
  const { data, error } = await supabase
    .from("messages")
    .select()
    .eq("document_id", documentId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[DB] Error loading history:", error);
    return [];
  }

  return data || [];
}

// ==================== Start Server ====================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  Talk With Doc - Voice AI Server                           ║
║                                                            ║
║  REST API:    http://localhost:${PORT}                        ║
║  WebSocket:   ws://localhost:${PORT}/ws/voice                 ║
║                                                            ║
║  Database:    Supabase ✓                                   ║
║                                                            ║
║  Endpoints:                                                ║
║    POST /api/documents    - Create document                ║
║    POST /api/sessions     - Create session                 ║
║    GET  /api/documents/:id                                 ║
║    GET  /api/sessions/:id/messages                         ║
║                                                            ║
║  Agents: Critic (onyx) + Creative (shimmer)                ║
║  Audio:  GPT-4o-audio-preview (direct mp3 output)          ║
╚════════════════════════════════════════════════════════════╝
  `);
});