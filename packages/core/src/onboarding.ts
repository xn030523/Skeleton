/**
 * Onboarding — first-run guided setup for provider selection, API key
 * entry, model choice, and test run. State persisted to .skeleton/onboarding.json.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface OnboardingStep {
  id: string;
  title: string;
  prompt: string;
  validate?: (input: string) => boolean;
  errorMessage?: string;
}

export interface OnboardingState {
  completed: boolean;
  currentStep: number;
  provider?: string;
  apiKey?: string;
  model?: string;
  testRunDone?: boolean;
  completedAt?: string;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "provider",
    title: "Select Provider",
    prompt: "Choose a provider (openai / anthropic / google / ollama):",
    validate: (v) => ["openai", "anthropic", "google", "ollama"].includes(v.trim().toLowerCase()),
    errorMessage: "Invalid provider. Choose: openai, anthropic, google, ollama",
  },
  {
    id: "apikey",
    title: "Set API Key",
    prompt: "Enter your API key:",
    validate: (v) => v.trim().length >= 8,
    errorMessage: "API key must be at least 8 characters",
  },
  {
    id: "model",
    title: "Select Model",
    prompt: "Enter model name (e.g. gpt-4o, claude-sonnet-4-20250514):",
    validate: (v) => v.trim().length > 0,
    errorMessage: "Model name cannot be empty",
  },
  {
    id: "testrun",
    title: "Test Run",
    prompt: "Run a test message? (y/n):",
    validate: (v) => ["y", "n", "yes", "no"].includes(v.trim().toLowerCase()),
    errorMessage: "Enter y or n",
  },
];

export class OnboardingManager {
  private statePath: string;

  constructor(statePath?: string) {
    const dir = path.join(os.homedir(), ".skeleton");
    this.statePath = statePath ?? path.join(dir, "onboarding.json");
  }

  /** Check if this is the first run (no completed onboarding state) */
  isFirstRun(): boolean {
    if (!fs.existsSync(this.statePath)) return true;
    try {
      const state: OnboardingState = JSON.parse(fs.readFileSync(this.statePath, "utf-8"));
      return !state.completed;
    } catch {
      return true;
    }
  }

  /** Load current onboarding state */
  loadState(): OnboardingState {
    if (!fs.existsSync(this.statePath)) {
      return { completed: false, currentStep: 0 };
    }
    try {
      return JSON.parse(fs.readFileSync(this.statePath, "utf-8"));
    } catch {
      return { completed: false, currentStep: 0 };
    }
  }

  /** Save onboarding state to disk */
  saveState(state: OnboardingState): void {
    const dir = path.dirname(this.statePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2), "utf-8");
  }

  /** Run the interactive onboarding flow. Accepts an input reader function for testability. */
  async runOnboarding(readInput?: (prompt: string) => Promise<string>): Promise<OnboardingState> {
    const reader = readInput ?? defaultReader;
    let state = this.loadState();

    for (let i = state.currentStep; i < ONBOARDING_STEPS.length; i++) {
      const step = ONBOARDING_STEPS[i];
      let valid = false;

      while (!valid) {
        const input = await reader(step.prompt);
        if (step.validate && !step.validate(input)) {
          console.error(step.errorMessage ?? "Invalid input, please try again.");
          continue;
        }
        valid = true;

        switch (step.id) {
          case "provider":
            state.provider = input.trim().toLowerCase();
            break;
          case "apikey":
            state.apiKey = input.trim();
            break;
          case "model":
            state.model = input.trim();
            break;
          case "testrun":
            state.testRunDone = input.trim().toLowerCase().startsWith("y");
            break;
        }
      }

      state.currentStep = i + 1;
      this.saveState(state);
    }

    state.completed = true;
    state.completedAt = new Date().toISOString();
    this.saveState(state);
    return state;
  }

  /** Get contextual hints based on current state */
  getHints(context?: string): string[] {
    const state = this.loadState();
    const hints: string[] = [];

    if (!state.completed) {
      hints.push("Onboarding incomplete. Run onboarding to configure your provider and API key.");
    }

    if (!state.apiKey) {
      hints.push("No API key configured. Set one via onboarding or environment variable.");
    }

    if (context === "tools" && !state.testRunDone) {
      hints.push("Try a test run to verify your setup works correctly.");
    }

    if (context === "provider" && state.provider) {
      hints.push(`Current provider: ${state.provider}. You can reconfigure via onboarding.`);
    }

    return hints;
  }
}

async function defaultReader(prompt: string): Promise<string> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
