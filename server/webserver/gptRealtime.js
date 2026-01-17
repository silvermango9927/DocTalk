import WebSocket from "ws";

export function connectGPTRealtime(onAudioChunk) {
  const ws = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-realtime-mini",
    {
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1"
      }
    }
  );

  ws.on("message", (msg) => {
    const event = JSON.parse(msg.toString());

    if (event.type === "response.audio.chunk") {
      onAudioChunk(Buffer.from(event.chunk, "base64"));
    }
  });

  return ws;
}
