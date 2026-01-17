import { StateGraph, END } from "@langchain/langgraph";
import { AgentState } from "./state";
import { supervisor } from "./agents/supervisor";
import { criticNode } from "./agents/analyst";
import { creativeNode } from "./agents/stylist";

async function supervisorNode(state: typeof AgentState.State) {
  const decision = await supervisor(state);
  return {
    next: decision.next,
  };
}
function routeFromSupervisor(state: typeof AgentState.State): string {
  const next = state.next;

  if (next === "FINISH") {
    return END;
  }

  return next;
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

  return workflow.compile();
}

export const graph = createAgentGraph();

// Utility function to run the graph with a user message
export async function runAgent(userMessage: string, documentContext?: string) {
  const { HumanMessage } = await import("@langchain/core/messages");

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
