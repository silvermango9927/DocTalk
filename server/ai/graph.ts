import { StateGraph, END } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { AgentState, AudioOutput } from "./state.js";
import { supervisor } from "./agents/supervisor.js";
import { criticNode } from "./agents/analyst.js";
import { creativeNode } from "./agents/stylist.js";
import { HumanMessage } from "@langchain/core/messages";
import dotenv from "dotenv";

dotenv.config();

// Memory checkpointer for persistence
const checkpointer = new MemorySaver();

async function supervisorNode(state: typeof AgentState.State) {
  const decision = await supervisor(state);
  return {
    next: decision.next,
  };
}

function routeFromSupervisor(state: typeof AgentState.State): string {
  const next = state.next;

  // Handle null, undefined, or empty next values
  if (!next || next === "FINISH") {
    return END;
  }

  // Only return valid agent names
  if (next === "critic" || next === "creative") {
    return next;
  }

  // Default to END for any unknown values
  return END;
}

export function createAgentGraph() {
  const workflow = new StateGraph(AgentState)
    // Add all nodes
    .addNode("supervisor", supervisorNode)
    .addNode("critic", criticNode)
    .addNode("creative", creativeNode)

    .addEdge("__start__", "supervisor")

    .addConditionalEdges("supervisor", routeFromSupervisor, {
      critic: "critic",
      creative: "creative",
      [END]: END,
    })

    .addEdge("critic", "supervisor")
    .addEdge("creative", "supervisor");

  return workflow.compile({ checkpointer });
}

export const graph = createAgentGraph();

// Callback type for handling audio outputs as they arrive
export type AudioCallback = (audio: AudioOutput) => Promise<void>;

// Stream the graph and handle interruptions
export async function streamAgent(
  userMessage: string,
  documentContext: string = "",
  threadId: string = "default",
  onAudio?: AudioCallback,
  interruptSignal?: { interrupted: boolean },
): Promise<{ messages: any[]; audioOutputs: AudioOutput[] }> {
  const config = {
    configurable: { thread_id: threadId },
  };

  const inputs = {
    messages: [new HumanMessage(userMessage)],
    documentContext,
    interrupted: false, // Fresh start - not interrupted
    audioOutputs: [], // Fresh audio outputs
    next: "supervisor", // Start fresh from supervisor
  };

  const allAudioOutputs: AudioOutput[] = [];
  let lastState: any = null;

  console.log(`[Graph] Starting agent graph execution`);
  console.log(`[Graph] Thread: ${threadId}`);
  console.log(`[Graph] User message: "${userMessage.substring(0, 50)}..."`);
  console.log(
    `[Graph] Document context: ${documentContext ? documentContext.length + " chars" : "NONE"}`,
  );

  try {
    // Stream the graph execution
    for await (const event of await graph.stream(inputs, {
      ...config,
      streamMode: "values",
    })) {
      // Check for interruption at the start of each event
      if (interruptSignal?.interrupted) {
        console.log("\n⚡ [Graph] Interrupted by user at event boundary!");

        // Update graph state to reflect interruption for any subsequent nodes
        await graph.updateState(config, { interrupted: true });
        break;
      }

      lastState = event;

      // Process new audio outputs
      if (
        event.audioOutputs &&
        event.audioOutputs.length > allAudioOutputs.length
      ) {
        const newAudios = event.audioOutputs.slice(allAudioOutputs.length);
        console.log(`[Graph] Processing ${newAudios.length} new audio outputs`);

        for (const audio of newAudios) {
          // Check interruption before processing each audio
          if (interruptSignal?.interrupted) {
            console.log(
              `\n⚡ [Graph] Interrupted before sending ${audio.agentName} audio!`,
            );
            return {
              messages: lastState?.messages || [],
              audioOutputs: allAudioOutputs,
            };
          }

          allAudioOutputs.push(audio);

          if (onAudio) {
            await onAudio(audio);

            // Check again after sending audio
            if (interruptSignal?.interrupted) {
              console.log(
                `\n⚡ [Graph] Interrupted after sending ${audio.agentName} audio!`,
              );
              return {
                messages: lastState?.messages || [],
                audioOutputs: allAudioOutputs,
              };
            }
          }
        }
      }
    }

    console.log("[Graph] Agent graph execution completed normally");
  } catch (error) {
    // If interrupted during agent execution, log it
    if (interruptSignal?.interrupted) {
      console.log("\n⚡ [Graph] Interrupted during agent execution!");
    } else {
      console.error("[Graph] Error during execution:", error);
      throw error;
    }
  }

  return {
    messages: lastState?.messages || [],
    audioOutputs: allAudioOutputs,
  };
}

// Resume conversation after interruption with new user input
export async function resumeWithInterruption(
  newUserMessage: string,
  documentContext: string = "",
  threadId: string = "default",
  onAudio?: AudioCallback,
  interruptSignal?: { interrupted: boolean },
): Promise<{ messages: any[]; audioOutputs: AudioOutput[] }> {
  // Use a NEW thread ID for the interruption to force fresh responses
  // This prevents the agents from repeating cached/previous responses
  const newThreadId = `${threadId}-interrupt-${Date.now()}`;

  const config = {
    configurable: { thread_id: newThreadId },
  };

  // Get previous state for context (but we'll be selective about what we keep)
  const oldConfig = { configurable: { thread_id: threadId } };
  const previousState = await graph.getState(oldConfig);

  // Build a FRESH conversation that includes:
  // 1. Only user messages from previous conversation (for context)
  // 2. The new user message (which should be the focus)
  const previousUserMessages = (previousState.values?.messages || [])
    .filter((msg: any) => msg._getType() === "human")
    .slice(-2); // Keep only last 2 user messages for context

  const inputs = {
    messages: [...previousUserMessages, new HumanMessage(newUserMessage)],
    documentContext: previousState.values?.documentContext || documentContext,
    next: "supervisor",
    audioOutputs: [], // Fresh audio outputs
  };

  const allAudioOutputs: AudioOutput[] = [];
  let lastState: any = null;

  // Stream with fresh state - agents will generate NEW responses
  for await (const event of await graph.stream(inputs, {
    ...config,
    streamMode: "values",
  })) {
    if (interruptSignal?.interrupted) {
      console.log("\n⚡ Interrupted by user!");
      break;
    }

    lastState = event;

    if (
      event.audioOutputs &&
      event.audioOutputs.length > allAudioOutputs.length
    ) {
      const newAudios = event.audioOutputs.slice(allAudioOutputs.length);
      for (const audio of newAudios) {
        allAudioOutputs.push(audio);
        if (onAudio) {
          if (interruptSignal?.interrupted) {
            console.log("\n⚡ Interrupted by user!");
            break;
          }
          await onAudio(audio);
        }
      }
    }
  }

  return {
    messages: lastState?.messages || [],
    audioOutputs: allAudioOutputs,
  };
}

// Utility function to run the graph with a user message (legacy)
export async function runAgent(userMessage: string, documentContext?: string) {
  const initialState = {
    messages: [new HumanMessage(userMessage)],
    next: "supervisor",
    documentContext: documentContext ?? "",
  };

  const result = await graph.invoke(initialState);

  const lastMessage = result.messages[result.messages.length - 1];
  return {
    response: lastMessage.content,
    messages: result.messages,
  };
}
