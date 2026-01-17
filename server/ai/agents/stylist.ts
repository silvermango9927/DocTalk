import { AgentState, AudioOutput } from "../state.js";
import { AIMessage } from "@langchain/core/messages";
import OpenAI from "openai";
import { CREATIVE_SYSTEM_PROMPT } from "../prompts.js";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function creativeNode(state: typeof AgentState.State) {
  // Check if interrupted before starting
  if (state.interrupted) {
    console.log("[Creative] Skipping - conversation interrupted");
    return {
      messages: [],
      audioOutputs: [],
    };
  }

  // Build conversation history for OpenAI format
  const conversationHistory: OpenAI.Chat.ChatCompletionMessageParam[] =
    state.messages.map((msg) => {
      const role = msg._getType() === "human" ? "user" : "assistant";
      return {
        role: role as "user" | "assistant",
        content: msg.content as string,
      };
    });

  // Build system prompt with document context
  const systemPrompt = state.documentContext
    ? `${CREATIVE_SYSTEM_PROMPT}\n\n---\nDOCUMENT CONTEXT:\n${state.documentContext}\n---\n\nUse this document context to inspire your creative insights when relevant.`
    : CREATIVE_SYSTEM_PROMPT;

  console.log(systemPrompt);

  console.log("[Creative] Generating response...");

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-audio-preview",
      modalities: ["text", "audio"],
      audio: { voice: "shimmer", format: "mp3" }, // Different voice for creative
      messages: [
        { role: "system", content: systemPrompt },
        ...conversationHistory,
      ],
    });

    const choice = response.choices[0];

    // Handle the audio response - the text might be in audio.transcript
    const audioData = choice.message.audio?.data || "";
    const transcript =
      choice.message.audio?.transcript || choice.message.content || "";

    console.log(
      `[Creative] Generated response: "${transcript.substring(0, 100)}..."`,
    );

    // Create audio output for streaming to client
    const audioOutput: AudioOutput = {
      agentName: "creative",
      audioData: audioData,
      transcript: transcript,
    };

    return {
      messages: [new AIMessage({ content: transcript, name: "creative" })],
      audioOutputs: [audioOutput],
    };
  } catch (error) {
    console.error("[Creative] Error generating response:", error);

    // Fallback to text-only if audio fails
    const fallbackResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        ...conversationHistory,
      ],
      max_tokens: 150,
    });

    const fallbackText =
      fallbackResponse.choices[0].message.content ||
      "Let me think of another way to look at this.";

    return {
      messages: [new AIMessage({ content: fallbackText, name: "creative" })],
      audioOutputs: [
        {
          agentName: "creative",
          audioData: "", // No audio in fallback
          transcript: fallbackText,
        },
      ],
    };
  }
}
