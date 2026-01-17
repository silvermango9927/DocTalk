import OpenAI, { toFile } from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface AudioChunk {
  data: string;  // base64 encoded
  sequence: number;
  sampleRate: number;
}

/**
 * Convert audio buffer to text using OpenAI Whisper
 */
export async function speechToText(audioChunks: AudioChunk[]): Promise<string> {
  try {
    if (audioChunks.length === 0) {
      console.log("[STT] No audio chunks to process");
      return "";
    }

    // Sort by sequence and combine
    audioChunks.sort((a, b) => a.sequence - b.sequence);
    
    const combinedBuffer = Buffer.concat(
      audioChunks.map(chunk => Buffer.from(chunk.data, "base64"))
    );

    if (combinedBuffer.length === 0) {
      console.log("[STT] Empty audio buffer");
      return "";
    }

    // Get sample rate from first chunk (browser might override our requested 16kHz)
    const sampleRate = audioChunks[0]?.sampleRate || 16000;
    
    console.log(`[STT] Processing ${audioChunks.length} chunks, ${combinedBuffer.length} bytes, ${sampleRate}Hz`);

    // Create a proper WAV file buffer
    const wavBuffer = createWavBuffer(combinedBuffer, sampleRate);

    // Use OpenAI's toFile helper for Node.js compatibility
    const file = await toFile(wavBuffer, "audio.wav", { type: "audio/wav" });

    const response = await openai.audio.transcriptions.create({
      file: file,
      model: "whisper-1",
      language: "en",
      response_format: "text",
    });

    const transcript = typeof response === "string" ? response : (response as any).text || "";
    
    console.log(`[STT] Transcribed: "${transcript}"`);
    return transcript.trim();

  } catch (error: any) {
    console.error("[STT] Error transcribing audio:", error?.message || error);
    
    // Log more details for debugging
    if (error?.error) {
      console.error("[STT] API Error details:", error.error);
    }
    
    return "";
  }
}

/**
 * Create a valid WAV file buffer from raw PCM data
 * PCM format: 16-bit signed integer, mono, little-endian
 */
function createWavBuffer(pcmData: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const byteRate = sampleRate * numChannels * bytesPerSample;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = pcmData.length;
  const fileSize = 36 + dataSize;  // Total file size minus 8 bytes for RIFF header
  
  // Create buffer for WAV file (44 byte header + PCM data)
  const wavBuffer = Buffer.alloc(44 + dataSize);
  
  let offset = 0;
  
  // RIFF chunk descriptor
  wavBuffer.write("RIFF", offset); offset += 4;
  wavBuffer.writeUInt32LE(fileSize, offset); offset += 4;
  wavBuffer.write("WAVE", offset); offset += 4;
  
  // fmt sub-chunk
  wavBuffer.write("fmt ", offset); offset += 4;
  wavBuffer.writeUInt32LE(16, offset); offset += 4;          // Subchunk1Size (16 for PCM)
  wavBuffer.writeUInt16LE(1, offset); offset += 2;           // AudioFormat (1 = PCM)
  wavBuffer.writeUInt16LE(numChannels, offset); offset += 2; // NumChannels
  wavBuffer.writeUInt32LE(sampleRate, offset); offset += 4;  // SampleRate
  wavBuffer.writeUInt32LE(byteRate, offset); offset += 4;    // ByteRate
  wavBuffer.writeUInt16LE(blockAlign, offset); offset += 2;  // BlockAlign
  wavBuffer.writeUInt16LE(bitsPerSample, offset); offset += 2; // BitsPerSample
  
  // data sub-chunk
  wavBuffer.write("data", offset); offset += 4;
  wavBuffer.writeUInt32LE(dataSize, offset); offset += 4;
  
  // Copy PCM data
  pcmData.copy(wavBuffer, offset);
  
  return wavBuffer;
}

/**
 * Debug helper: Save WAV to file for testing
 */
export async function debugSaveWav(audioChunks: AudioChunk[], filename: string): Promise<void> {
  const fs = await import("fs");
  
  audioChunks.sort((a, b) => a.sequence - b.sequence);
  const combinedBuffer = Buffer.concat(
    audioChunks.map(chunk => Buffer.from(chunk.data, "base64"))
  );
  
  const sampleRate = audioChunks[0]?.sampleRate || 16000;
  const wavBuffer = createWavBuffer(combinedBuffer, sampleRate);
  
  fs.writeFileSync(filename, wavBuffer);
  console.log(`[STT] Debug: Saved WAV to ${filename} (${wavBuffer.length} bytes)`);
}