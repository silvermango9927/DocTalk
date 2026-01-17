import { ChatOpenAI } from "@langchain/openai";
import { AgentState } from "../state";

export async function stylistNode(state: typeof AgentState.State) {
  const model = new ChatOpenAI({ modelName: "gpt-4o", temperature: 0.7 });

  const systemMessage = {
    role: "system",
    content: `You are a Personality Agent. Your job is to make the information sound human, 
    warm, and engaging. You are talking to the user through a voice interface, so keep 
    sentences punchy and easy to listen to. Use the Analyst's data but give it 'soul'.`,
  };

  const response = await model.invoke([systemMessage, ...state.messages]);

  return {
    messages: [response],
  };
}
