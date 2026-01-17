import { HumanMessage } from "@langchain/core/messages";
import { graph } from "./graph";
import { spawn } from "child_process";
import { Readable } from "stream";
import dotenv from "dotenv";

dotenv.config();

async function playAudio(base64Audio: string): Promise<void> {
  const buffer = Buffer.from(base64Audio, "base64");
  const audioStream = Readable.from(buffer);

  return new Promise((resolve) => {
    const player = spawn(
      "ffplay",
      ["-nodisp", "-autoexit", "-loglevel", "quiet", "-"],
      { stdio: ["pipe", "ignore", "ignore"] },
    );

    audioStream.pipe(player.stdin);

    player.on("close", () => resolve());
    player.on("error", () => {
      // Fallback to afplay if ffplay not available
      const { exec } = require("child_process");
      const { writeFileSync, unlinkSync } = require("fs");
      const tempFile = `/tmp/agent_${Date.now()}.mp3`;
      writeFileSync(tempFile, buffer);
      exec(`afplay "${tempFile}"`, () => {
        unlinkSync(tempFile);
        resolve();
      });
    });
  });
}

async function runTest() {
  console.log("🚀 Starting Voice Agent Dialogue...\n");

  const mockDocument = `
    Slide 1: Introduction to Project X. 
    Project X is a voice-controlled Chrome extension for Google Docs.
    Slide 2: Technical Stack. 
    It uses Node.js, LangGraph, and OpenAI Realtime API.
  `;

  const inputs = {
    messages: [new HumanMessage("What is the tech stack for Project X?")],
    documentContext: mockDocument,
  };

  try {
    const result = await graph.invoke(inputs);

    console.log("--- VOICE AGENT DIALOGUE ---\n");

    // Print user message
    const userMessage = result.messages.find(
      (m: any) => m._getType() === "human",
    );
    if (userMessage) {
      console.log(`👤 User: ${userMessage.content}\n`);
    }

    // Play each agent's audio output in order
    for (const audio of result.audioOutputs) {
      console.log(
        `🎙️ ${audio.agentName.charAt(0).toUpperCase() + audio.agentName.slice(1)} : ${audio.transcript}\n`,
      );

      if (audio.audioData) {
        await playAudio(audio.audioData);
      }
    }

    console.log("--- END OF DIALOGUE ---");
  } catch (error) {
    console.error("❌ Graph Execution Error:", error);
  }
}

runTest();
