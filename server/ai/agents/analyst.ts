import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { AgentState } from "../state";

export async function analyst(state: typeof AgentState.state) {
  const model = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0.5,
  });

  const systemPrompt = `
    You are a helpful assistant that analyzes data and provides insights.
    You are given a list of messages and you need to analyze the data and provide insights.

    Return your analysis in the following format:
    - Summary of the data
    - Key insights
    - Recommendations
    - Any other relevant information
  `;

  const messages = [new SystemMessage(systemPrompt), ...infoMessages];

  const response = await model.invoke(messages);

  return response.content as string;
}
