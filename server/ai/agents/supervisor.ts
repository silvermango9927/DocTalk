import { AgentState } from "../state";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { SUPERVISOR_SYSTEM_PROMPT } from "../prompts";
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

  // Count agent exchanges and identify last speaker
  const agentMessages = state.messages.filter(
    (msg) => msg.name === "critic" || msg.name === "creative",
  );
  const exchangeCount = agentMessages.length;
  const lastSpeaker = agentMessages[agentMessages.length - 1]?.name || null;

  const conversationContext = state.messages
    .map((msg) => {
      const speaker = msg.name || msg._getType();
      return `${speaker}: ${msg.content}`;
    })
    .join("\n");

  const userMessage = `
User Request: ${state.messages.find((m) => m._getType() === "human")?.content || "No request provided"}

Conversation History:
${conversationContext}

Dialogue Status:
- Number of agent exchanges so far: ${exchangeCount}
- Last agent to speak: ${lastSpeaker || "none"}

Decide which agent should speak next to continue the dialogue, or FINISH if the conversation is complete.
Remember: Alternate between critic and creative. Start with critic. End after 2-4 exchanges.
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
