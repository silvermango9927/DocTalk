import {
  AIMessage,
  SystemMessage,
  HumanMessage,
} from "@langchain/core/messages";
import { AgentState } from "../state";
import { CRITIC_SYSTEM_PROMPT } from "../prompts";
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function criticNode(state: typeof AgentState.State) {
  // Build context from document if available
  const contextMessage = state.documentContext
    ? `\n\nDocument Context:\n${state.documentContext}`
    : "";

  // Convert LangChain messages to OpenAI format
  const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: CRITIC_SYSTEM_PROMPT + contextMessage },
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
    audio: { voice: "onyx", format: "mp3" },
    messages: openaiMessages,
  });

  const choice = response.choices[0];
  const transcript =
    choice.message.audio?.transcript || choice.message.content || "";
  const audioData = choice.message.audio?.data || "";

  return {
    messages: [
      new AIMessage({
        content: `Critic : ${transcript}`,
        name: "critic",
      }),
    ],
    audioOutputs: [
      {
        agentName: "critic",
        audioData: audioData,
        transcript: transcript,
      },
    ],
  };
}
