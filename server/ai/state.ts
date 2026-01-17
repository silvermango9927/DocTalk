import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

export interface AudioOutput {
  agentName: string;
  audioData: string; // base64 encoded audio
  transcript: string;
}

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),

  next: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "supervisor",
  }),

  documentContext: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),

  audioOutputs: Annotation<AudioOutput[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),

  interrupted: Annotation<boolean>({
    reducer: (x, y) => y ?? x,
    default: () => false,
  }),
});
