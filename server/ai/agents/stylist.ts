import {
  AIMessage,
  SystemMessage,
  HumanMessage,
} from "@langchain/core/messages";
import { AgentState } from "../state";
import { CREATIVE_SYSTEM_PROMPT } from "../prompts";
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function creativeNode(state: typeof AgentState.State) {
  // Build context from document if available
  const contextMessage = state.documentContext
    ? `\n\nDocument Context:\n${state.documentContext}`
    : "";

  // Convert LangChain messages to OpenAI format
  const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: CREATIVE_SYSTEM_PROMPT + contextMessage },
    ...state.messages.map((msg) => ({
      role: (msg._getType() === "human" ? "user" : "assistant") as
        | "user"
        | "assistant",
      content: msg.content as string,
    })),
  ];

  // Use gpt-4o-audio-preview for direct audio generation
  const response = await openai.chat.completions.create({
    model: "gpt-4o-audio-preview",
    modalities: ["text", "audio"],
    audio: { voice: "nova", format: "mp3" },
    messages: openaiMessages,
  });

  const choice = response.choices[0];
  const transcript =
    choice.message.audio?.transcript || choice.message.content || "";
  const audioData = choice.message.audio?.data || "";

  return {
    messages: [
      new AIMessage({
        content: `Creative : ${transcript}`,
        name: "creative",
      }),
    ],
    audioOutputs: [
      {
        agentName: "creative",
        audioData: audioData,
        transcript: transcript,
      },
    ],
  };
}
