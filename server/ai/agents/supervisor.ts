import { AgentState } from "../state.js";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { SUPERVISOR_SYSTEM_PROMPT } from "../prompts.js";
import dotenv from "dotenv";
dotenv.config();

// Valid routing options including FINISH to return control to user
type RoutingDecision = "critic" | "creative" | "FINISH";

interface SupervisorOutput {
  next: RoutingDecision;
  reasoning: string;
}

export async function supervisor(
  state: typeof AgentState.State,
): Promise<SupervisorOutput> {
  const options = ["critic", "creative", "FINISH"];

  const chat = new ChatOpenAI({
    temperature: 0,
    modelName: "gpt-4",
    apiKey: process.env.OPENAI_API_KEY,
  });

  const parser = new JsonOutputParser<SupervisorOutput>();

  // Find all user messages
  const userMessages = state.messages.filter(
    (msg) => msg._getType() === "human",
  );
  const latestUserMessage = userMessages[userMessages.length - 1];
  const hasMultipleUserMessages = userMessages.length > 1;

  // Find the index of the latest user message
  const latestUserMessageIndex = state.messages.findIndex(
    (msg) => msg === latestUserMessage,
  );

  // Count agent exchanges AFTER the latest user message (for the current topic)
  const messagesAfterLatestUser = state.messages.slice(
    latestUserMessageIndex + 1,
  );
  const agentMessagesForCurrentTopic = messagesAfterLatestUser.filter(
    (msg) => msg.name === "critic" || msg.name === "creative",
  );
  const exchangeCount = agentMessagesForCurrentTopic.length;
  const lastSpeaker =
    agentMessagesForCurrentTopic[agentMessagesForCurrentTopic.length - 1]
      ?.name || null;

  const conversationContext = state.messages
    .map((msg) => {
      const speaker = msg.name || msg._getType();
      return `${speaker}: ${msg.content}`;
    })
    .join("\n");

  const userMessage = `
LATEST User Request (FOCUS ON THIS): ${latestUserMessage?.content || "No request provided"}

${hasMultipleUserMessages ? "NOTE: The user has sent a FOLLOW-UP message. This is a new topic - agents should address THIS message specifically.\n" : ""}
Full Conversation History:
${conversationContext}

Current Topic Status:
- Number of agent exchanges on CURRENT topic (after latest user message): ${exchangeCount}
- Last agent to speak on current topic: ${lastSpeaker || "none"}
- Is this a follow-up/interruption: ${hasMultipleUserMessages ? "YES - start fresh with critic" : "NO"}

Decide which agent should speak next to continue the dialogue, or FINISH if the conversation is complete.
Remember: For a NEW user message, always start with critic. Alternate between critic and creative. End after 2-4 exchanges per topic.
Respond with valid JSON only.`;

  const response = await chat.invoke([
    new SystemMessage(SUPERVISOR_SYSTEM_PROMPT(options)),
    new HumanMessage(userMessage),
  ]);

  try {
    const parsed = await parser.parse(response.content as string);

    // Validate the routing decision
    if (!["critic", "creative", "FINISH"].includes(parsed.next)) {
      return {
        next: "FINISH",
        reasoning: "Invalid routing decision, defaulting to FINISH",
      };
    }

    return parsed;
  } catch (error) {
    // If parsing fails, default to FINISH
    console.error("Failed to parse supervisor response:", error);
    return {
      next: "FINISH",
      reasoning: "Failed to parse response, returning control to user",
    };
  }
}

export function createSupervisorNode() {
  return async (state: typeof AgentState.State) => {
    const decision = await supervisor(state);
    return {
      next: decision.next,
    };
  };
}

// Conditional edge function for LangGraph routing
export function routeToAgent(state: {
  next: RoutingDecision;
}): RoutingDecision {
  return state.next;
}

// Export types for use in graph
export type { RoutingDecision };
