import { HumanMessage } from "@langchain/core/messages";
import { streamAgent, resumeWithInterruption, AudioCallback } from "./graph";
import { AudioOutput } from "./state";
import { spawn, ChildProcess } from "child_process";
import { Readable } from "stream";
import * as readline from "readline";
import dotenv from "dotenv";

dotenv.config();

// Track current audio player for interruption
let currentPlayer: ChildProcess | null = null;
let isAudioStopped = false;

async function playAudio(base64Audio: string): Promise<void> {
  const buffer = Buffer.from(base64Audio, "base64");
  const audioStream = Readable.from(buffer);
  isAudioStopped = false;

  return new Promise((resolve) => {
    currentPlayer = spawn(
      "ffplay",
      ["-nodisp", "-autoexit", "-loglevel", "quiet", "-"],
      { stdio: ["pipe", "ignore", "ignore"] },
    );

    // Handle stdin errors (EPIPE when player is killed)
    currentPlayer.stdin?.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EPIPE" || isAudioStopped) {
        // Expected when audio is stopped, ignore
      }
    });

    // Only pipe if not already stopped
    if (!isAudioStopped && currentPlayer.stdin) {
      audioStream.pipe(currentPlayer.stdin);
    }

    currentPlayer.on("close", () => {
      currentPlayer = null;
      resolve();
    });
    currentPlayer.on("error", () => {
      currentPlayer = null;
      // Fallback to afplay
      if (!isAudioStopped) {
        const { exec } = require("child_process");
        const { writeFileSync, unlinkSync } = require("fs");
        const tempFile = `/tmp/agent_${Date.now()}.mp3`;
        writeFileSync(tempFile, buffer);
        exec(`afplay "${tempFile}"`, () => {
          unlinkSync(tempFile);
          resolve();
        });
      } else {
        resolve();
      }
    });
  });
}

function stopAudio() {
  isAudioStopped = true;
  if (currentPlayer) {
    try {
      // Destroy stdin first to prevent EPIPE
      if (currentPlayer.stdin && !currentPlayer.stdin.destroyed) {
        currentPlayer.stdin.destroy();
      }
      currentPlayer.kill("SIGKILL");
    } catch (e) {
      // Ignore errors when stopping
    }
    currentPlayer = null;
  }
}

async function runInteractiveSession() {
  console.log("🚀 Starting Interactive Voice Agent Dialogue");
  console.log("📝 Type your message and press Enter to start");
  console.log("⚡ Type while agents are speaking to interrupt them");
  console.log("❌ Type 'quit' to exit\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const mockDocument = `
    Slide 1: Introduction to Project X. 
    Project X is a voice-controlled Chrome extension for Google Docs.
    Slide 2: Technical Stack. 
    It uses Node.js, LangGraph, and OpenAI Realtime API.
  `;

  const threadId = `session-${Date.now()}`;
  let interruptSignal = { interrupted: false };
  let isProcessing = false;
  let pendingInterruption: string | null = null;

  // Audio callback that plays audio and checks for interruption
  const onAudio: AudioCallback = async (audio: AudioOutput) => {
    if (interruptSignal.interrupted) return;

    console.log(
      `🎙️ ${audio.agentName.charAt(0).toUpperCase() + audio.agentName.slice(1)} : ${audio.transcript}\n`,
    );

    if (audio.audioData && !interruptSignal.interrupted) {
      await playAudio(audio.audioData);
    }
  };

  const processInput = async (input: string, isResume: boolean = false) => {
    isProcessing = true;
    interruptSignal = { interrupted: false };

    console.log(`\n👤 User: ${input}\n`);
    console.log("--- VOICE AGENT DIALOGUE ---\n");

    try {
      if (isResume) {
        await resumeWithInterruption(
          input,
          mockDocument,
          threadId,
          onAudio,
          interruptSignal,
        );
      } else {
        await streamAgent(
          input,
          mockDocument,
          threadId,
          onAudio,
          interruptSignal,
        );
      }

      if (!interruptSignal.interrupted) {
        console.log("--- END OF DIALOGUE ---\n");
      }
    } catch (error) {
      console.error("❌ Error:", error);
    }

    isProcessing = false;

    // Handle pending interruption
    if (pendingInterruption) {
      const msg = pendingInterruption;
      pendingInterruption = null;
      await processInput(msg, true);
    }
  };

  rl.on("line", async (input) => {
    const trimmed = input.trim();

    if (trimmed.toLowerCase() === "quit") {
      console.log("\n👋 Goodbye!");
      stopAudio();
      rl.close();
      process.exit(0);
    }

    if (!trimmed) return;

    if (isProcessing) {
      // Interrupt current processing
      console.log("\n⚡ Interrupting agents...");
      interruptSignal.interrupted = true;
      stopAudio();
      pendingInterruption = trimmed;
    } else {
      await processInput(trimmed, false);
    }
  });

  // Start with initial prompt
  rl.question("💬 You: ", async (input) => {
    if (input.trim()) {
      await processInput(input.trim());
    }

    // Keep prompting
    const promptUser = () => {
      if (!isProcessing) {
        rl.question("💬 You: ", async (input) => {
          if (input.trim() && input.trim().toLowerCase() !== "quit") {
            await processInput(input.trim(), true);
          }
          promptUser();
        });
      } else {
        setTimeout(promptUser, 100);
      }
    };
    promptUser();
  });
}

runInteractiveSession();
