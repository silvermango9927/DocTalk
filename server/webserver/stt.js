import fs from "fs";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function speechToText(audioBuffer) {
  const tempFile = `/tmp/audio-${Date.now()}.wav`;
  fs.writeFileSync(tempFile, audioBuffer);

  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(tempFile),
    model: "gpt-4o-transcribe"
  });

  fs.unlinkSync(tempFile);
  return transcription.text;
}
