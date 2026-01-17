
// import express from "express";
// import { WebSocketServer } from "ws";
// import { supabase } from "./supabase.js";
// import { speechToText } from "./stt.js";
// import { connectGPTRealtime } from "./gptRealtime.js";

// const app = express();
// app.use(express.json());

// /**
//  * Initialize session
//  */
// app.post("/session", async (req, res) => {
//   const { docText } = req.body;

//   const { data, error } = await supabase
//     .from("sessions")
//     .insert([{ doc_text: docText }])
//     .select()
//     .single();

//   if (error) {
//     console.error(error);
//     return res.status(500).json({ error });
//   }

//   res.json({ sessionId: data.id });
// });

// const server = app.listen(3000);
// const wss = new WebSocketServer({ server });

// wss.on("connection", (client, req) => {
//   const sessionId = new URL(req.url, "http://x").searchParams.get("sessionId");

//   const gptWS = connectGPTRealtime((audioChunk) => {
//     client.send(audioChunk);
//   });

//   client.on("message", async (audioData) => {
//     // 1. STT
//     const text = await speechToText(audioData);

//     // 2. Save user message
//     await supabase.from("messages").insert({
//       session_id: sessionId,
//       sender: "user",
//       text
//     });

//     // 3. Send text to GPT
//     gptWS.send(JSON.stringify({
//       type: "input_text",
//       text
//     }));
//   });
// });

// console.log("Backend starting...");

// app.get("/health", (req, res) => {
//     res.json({ status: "ok" });
// });

// app.get("/test-db", async (req, res) => {
//     const { data, error } = await supabase.from("sessions").select("*").limit(1);
//     res.json({ data, error });
// });
  
  
/**
 * Backend Reference Implementation
 * 
 * Matches your database schema:
 * - documents(id uuid, created_at timestamptz, doc_text text)
 * - sessions(id uuid, user_id uuid, document_id uuid, created_at timestamptz)
 * - messages(id uuid, document_id uuid, created_at timestamptz, sender text, text text)
 * 
 * Install: npm install express ws cors uuid
 * For Supabase: npm install @supabase/supabase-js
 */

const express = require('express');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const http = require('http');
// const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));  // Large docs

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/voice' });

// ==================== Database Setup ====================
// Replace with your Supabase client
// const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// For demo: in-memory storage (replace with Supabase queries)
const db = {
  documents: new Map(),
  sessions: new Map(),
  messages: new Map()
};

// ==================== REST API Endpoints ====================

/**
 * POST /api/documents
 * Create a new document
 * 
 * Request:  { doc_text: string }
 * Response: { id: uuid, created_at: timestamp, doc_text: string }
 */
app.post('/api/documents', async (req, res) => {
  try {
    const { doc_text } = req.body;
    
    if (!doc_text) {
      return res.status(400).json({ error: 'doc_text is required' });
    }

    const document = {
      id: uuidv4(),
      created_at: new Date().toISOString(),
      doc_text: doc_text
    };
    
    // Supabase version:
    // const { data, error } = await supabase
    //   .from('documents')
    //   .insert({ doc_text })
    //   .select()
    //   .single();
    // if (error) throw error;
    // return res.json(data);

    db.documents.set(document.id, document);
    console.log(`Document created: ${document.id}`);
    
    res.json(document);
  } catch (error) {
    console.error('Error creating document:', error);
    res.status(500).json({ error: 'Failed to create document' });
  }
});

/**
 * GET /api/documents/:id
 * Get a document by ID
 */
app.get('/api/documents/:id', async (req, res) => {
  try {
    const document = db.documents.get(req.params.id);
    
    // Supabase version:
    // const { data, error } = await supabase
    //   .from('documents')
    //   .select()
    //   .eq('id', req.params.id)
    //   .single();
    
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    res.json(document);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get document' });
  }
});

/**
 * POST /api/sessions
 * Create a new session linking user to document
 * 
 * Request:  { user_id: uuid, document_id: uuid }
 * Response: { id: uuid, user_id: uuid, document_id: uuid, created_at: timestamp }
 */
app.post('/api/sessions', async (req, res) => {
  try {
    const { user_id, document_id } = req.body;
    
    if (!user_id || !document_id) {
      return res.status(400).json({ error: 'user_id and document_id are required' });
    }

    const session = {
      id: uuidv4(),
      user_id: user_id,
      document_id: document_id,
      created_at: new Date().toISOString()
    };
    
    // Supabase version:
    // const { data, error } = await supabase
    //   .from('sessions')
    //   .insert({ user_id, document_id })
    //   .select()
    //   .single();

    db.sessions.set(session.id, session);
    console.log(`Session created: ${session.id} for document: ${document_id}`);
    
    res.json(session);
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

/**
 * GET /api/sessions/:id/messages
 * Get all messages for a session's document
 */
app.get('/api/sessions/:id/messages', async (req, res) => {
  try {
    const session = db.sessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Get messages for this document
    const messages = Array.from(db.messages.values())
      .filter(m => m.document_id === session.document_id)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    
    // Supabase version:
    // const { data, error } = await supabase
    //   .from('messages')
    //   .select()
    //   .eq('document_id', session.document_id)
    //   .order('created_at', { ascending: true });
    
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// ==================== WebSocket Handler ====================

// Active connections: visitorId -> { ws, sessionId, documentId, userId }
const connections = new Map();

wss.on('connection', (ws, req) => {
  console.log('New WebSocket connection');
  
  let connectionData = {
    visitorId: uuidv4(),
    sessionId: null,
    documentId: null,
    userId: null
  };
  
  let audioBuffer = [];

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        
        // ============ CONNECTION INIT ============
        case 'connection_init':
          connectionData.sessionId = message.sessionId;
          connectionData.documentId = message.documentId;
          connectionData.userId = message.userId;
          
          connections.set(connectionData.visitorId, { ws, ...connectionData });
          
          console.log(`Connected: user=${message.userId}, session=${message.sessionId}, doc=${message.documentId}`);
          
          // Load document context for agents
          const document = db.documents.get(message.documentId);
          if (document) {
            connectionData.docText = document.doc_text;
          }
          
          ws.send(JSON.stringify({
            type: 'connection_ack',
            sessionId: message.sessionId,
            userId: message.userId,
            timestamp: Date.now()
          }));
          break;

        // ============ SPEECH START ============
        case 'speech_start':
          console.log(`Speech started: user=${message.userId}`);
          audioBuffer = [];
          break;

        // ============ AUDIO CHUNK ============
        case 'audio_chunk':
          audioBuffer.push({
            data: message.data,
            sequence: message.sequence
          });
          break;

        // ============ SPEECH END ============
        case 'speech_end':
          console.log(`Speech ended: user=${message.userId}, chunks=${audioBuffer.length}`);
          
          // 1. Process audio -> text (STT)
          const transcript = await speechToText(audioBuffer);
          audioBuffer = [];
          
          if (!transcript) {
            ws.send(JSON.stringify({ type: 'error', message: 'Could not transcribe audio' }));
            break;
          }
          
          // 2. Save user message to database
          const userMessage = await saveMessage({
            document_id: connectionData.documentId,
            sender: 'user',
            text: transcript
          });
          
          // 3. Send transcript back to client
          ws.send(JSON.stringify({
            type: 'transcript',
            text: transcript,
            messageId: userMessage.id,
            timestamp: Date.now()
          }));
          
          // 4. Get agent response (with document context)
          const agentResponse = await getAgentResponse(
            transcript,
            connectionData.docText,
            connectionData.documentId
          );
          
          // 5. Save agent message to database
          const agentMessage = await saveMessage({
            document_id: connectionData.documentId,
            sender: agentResponse.agentId,  // e.g., 'agent_editor', 'agent_critic'
            text: agentResponse.text
          });
          
          // 6. Convert to speech (TTS) and send back
          const audioBase64 = await textToSpeech(agentResponse.text);
          
          ws.send(JSON.stringify({
            type: 'agent_response',
            agentId: agentResponse.agentId,
            text: agentResponse.text,
            audio: audioBase64,
            messageId: agentMessage.id,
            timestamp: Date.now()
          }));
          break;

        // ============ DISCONNECT ============
        case 'disconnect':
          console.log(`Disconnecting: user=${message.userId}`);
          connections.delete(connectionData.visitorId);
          break;
      }

    } catch (error) {
      console.error('WebSocket error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: error.message,
        timestamp: Date.now()
      }));
    }
  });

  ws.on('close', () => {
    console.log(`Connection closed: ${connectionData.visitorId}`);
    connections.delete(connectionData.visitorId);
  });
});

// ==================== Helper Functions ====================

/**
 * Save a message to the database
 * Matches schema: messages(id, document_id, created_at, sender, text)
 */
async function saveMessage({ document_id, sender, text }) {
  const message = {
    id: uuidv4(),
    document_id: document_id,
    created_at: new Date().toISOString(),
    sender: sender,  // 'user', 'agent_editor', 'agent_critic', etc.
    text: text
  };
  
  // Supabase version:
  // const { data, error } = await supabase
  //   .from('messages')
  //   .insert({ document_id, sender, text })
  //   .select()
  //   .single();
  // if (error) throw error;
  // return data;
  
  db.messages.set(message.id, message);
  console.log(`Message saved: ${sender} -> "${text.substring(0, 50)}..."`);
  
  return message;
}

/**
 * Convert audio buffer to text using STT service
 * TODO: Integrate with Deepgram, Whisper, or AssemblyAI
 */
async function speechToText(audioBuffer) {
  // Sort by sequence and combine
  audioBuffer.sort((a, b) => a.sequence - b.sequence);
  const combinedAudio = Buffer.concat(
    audioBuffer.map(chunk => Buffer.from(chunk.data, 'base64'))
  );
  
  // Example with Deepgram:
  // const { createClient } = require('@deepgram/sdk');
  // const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
  // const { result } = await deepgram.listen.prerecorded.transcribeFile(
  //   combinedAudio,
  //   { model: 'nova-2', smart_format: true }
  // );
  // return result.results.channels[0].alternatives[0].transcript;
  
  // Example with OpenAI Whisper:
  // const formData = new FormData();
  // formData.append('file', new Blob([combinedAudio]), 'audio.wav');
  // formData.append('model', 'whisper-1');
  // const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
  //   method: 'POST',
  //   headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
  //   body: formData
  // });
  // const data = await response.json();
  // return data.text;
  
  // Placeholder
  console.log(`STT: Processing ${audioBuffer.length} chunks (${combinedAudio.length} bytes)`);
  return "This is a placeholder transcript. Integrate STT service.";
}

/**
 * Get response from AI agent with document context
 * TODO: Integrate with OpenAI, Anthropic, etc.
 */
async function getAgentResponse(userMessage, documentContext, documentId) {
  // Load conversation history
  const history = Array.from(db.messages.values())
    .filter(m => m.document_id === documentId)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .slice(-10);  // Last 10 messages for context
  
  // Build system prompt with document context
  const systemPrompt = `You are a helpful assistant reviewing the following document. 
Provide insightful feedback and answer questions about it.

DOCUMENT:
${documentContext?.substring(0, 4000) || 'No document loaded'}

Respond naturally and conversationally. Keep responses concise for voice.`;

  // Example with OpenAI:
  // const response = await fetch('https://api.openai.com/v1/chat/completions', {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //     'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
  //   },
  //   body: JSON.stringify({
  //     model: 'gpt-4',
  //     messages: [
  //       { role: 'system', content: systemPrompt },
  //       ...history.map(m => ({
  //         role: m.sender === 'user' ? 'user' : 'assistant',
  //         content: m.text
  //       })),
  //       { role: 'user', content: userMessage }
  //     ],
  //     max_tokens: 300
  //   })
  // });
  // const data = await response.json();
  // return {
  //   agentId: 'agent_assistant',
  //   text: data.choices[0].message.content
  // };
  
  // Placeholder
  return {
    agentId: 'agent_assistant',
    text: `I received: "${userMessage}". This is a placeholder. Integrate your LLM.`
  };
}

/**
 * Convert text to speech
 * TODO: Integrate with ElevenLabs, PlayHT, or OpenAI TTS
 */
async function textToSpeech(text) {
  // Example with ElevenLabs:
  // const response = await fetch(
  //   `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
  //   {
  //     method: 'POST',
  //     headers: {
  //       'Content-Type': 'application/json',
  //       'xi-api-key': process.env.ELEVENLABS_API_KEY
  //     },
  //     body: JSON.stringify({
  //       text: text,
  //       model_id: 'eleven_monolingual_v1'
  //     })
  //   }
  // );
  // const audioBuffer = await response.arrayBuffer();
  // return Buffer.from(audioBuffer).toString('base64');
  
  // Example with OpenAI TTS:
  // const response = await fetch('https://api.openai.com/v1/audio/speech', {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //     'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
  //   },
  //   body: JSON.stringify({
  //     model: 'tts-1',
  //     voice: 'nova',
  //     input: text
  //   })
  // });
  // const audioBuffer = await response.arrayBuffer();
  // return Buffer.from(audioBuffer).toString('base64');
  
  // Placeholder - return null (frontend handles missing audio gracefully)
  console.log(`TTS: "${text.substring(0, 50)}..."`);
  return null;
}

// ==================== Data Flow Summary ====================
/*
FRONTEND → BACKEND FLOW:

1. User extracts Google Doc
   └─▶ POST /api/documents { doc_text }
       └─▶ Returns { id, created_at, doc_text }
   
2. Frontend creates session
   └─▶ POST /api/sessions { user_id, document_id }
       └─▶ Returns { id, user_id, document_id, created_at }

3. Frontend connects WebSocket
   └─▶ WS /ws/voice
       └─▶ Sends: { type: 'connection_init', userId, sessionId, documentId }
       └─▶ Receives: { type: 'connection_ack', ... }

4. User speaks
   └─▶ Sends: { type: 'speech_start', ... }
   └─▶ Sends: { type: 'audio_chunk', data: base64, sequence, ... } (multiple)
   └─▶ Sends: { type: 'speech_end', duration, ... }

5. Backend processes
   └─▶ STT: audio → text
   └─▶ Save to messages: { document_id, sender: 'user', text }
   └─▶ Sends: { type: 'transcript', text }
   └─▶ LLM: generate response with doc context
   └─▶ Save to messages: { document_id, sender: 'agent_xxx', text }
   └─▶ TTS: text → audio
   └─▶ Sends: { type: 'agent_response', agentId, text, audio }

6. Loop back to step 4 for next user utterance
*/

// ==================== Start Server ====================
const PORT = process.env.PORT || 3000;
console.log(PORT);

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════╗
║  Voice Agent Backend                           ║
║                                                ║
║  REST API:    http://localhost:${PORT}         ║
║  WebSocket:   ws://localhost:${PORT}/ws/voice  ║
║                                                ║
║  Endpoints:                                    ║
║    POST /api/documents    - Create document    ║
║    POST /api/sessions     - Create session     ║
║    GET  /api/documents/:id                     ║
║    GET  /api/sessions/:id/messages             ║
║                                                ║
║  TODO: Integrate STT, TTS, and LLM services    ║
╚════════════════════════════════════════════════╝
  `);
});