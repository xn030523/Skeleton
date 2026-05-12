/**
 * Background Review — post-turn self-improvement fork.
 *
 * Every N user turns (memory) or tool-call iterations (skill), we spawn a
 * short-lived sub-agent with a restricted toolset (memory + skill tools only)
 * and one of three review prompts. The fork runs AFTER the main response has
 * been delivered to the user, so it never competes with the primary task.
 *
 * Ported from Hermes `_spawn_background_review` + `_SKILL_REVIEW_PROMPT` etc.
 * Skeleton simplifies:
 *   - Shares the same AgentConfig (provider / model / api key) as parent
 *   - Fork runs in-process (no threading; Node's event loop is enough)
 *   - Tool filter by name whitelist instead of Hermes' toolset groups
 *   - Summarizes successful memory/skill actions and invokes a callback so
 *     the UI can print a one-line "💾 Self-improvement review: ..." notice.
 */

import type { Message, ToolDef, AgentConfig } from "../types.js";

const DEFAULT_MEMORY_INTERVAL = 10;    // Run memory review every N user turns
const DEFAULT_SKILL_INTERVAL = 10;     // Run skill review every N tool iterations

/** Tools the review fork is allowed to call. Anything else is filtered out. */
const REVIEW_TOOLSET = new Set([
  "memory",
  "memory_search",
  "memory_recall",
  "skill_manage",
  "skill_view",
  "skill_resource",
]);

export const MEMORY_REVIEW_PROMPT = `Review the conversation above and consider saving to memory if appropriate.

Focus on:
1. Has the user revealed things about themselves — persona, desires, preferences, or personal details worth remembering?
2. Has the user expressed expectations about how you should behave, their work style, or ways they want you to operate?

If something stands out, save it using the memory tool.
If nothing is worth saving, just say 'Nothing to save.' and stop.`;

export const SKILL_REVIEW_PROMPT = `Review the conversation above and update the skill library. Be ACTIVE — most sessions produce at least one skill update, even if small. A pass that does nothing is a missed learning opportunity, not a neutral outcome.

Target shape of the library: CLASS-LEVEL skills, each with a rich SKILL.md and a \`references/\` directory for session-specific detail. Not a long flat list of narrow one-session-one-skill entries.

Signals to look for (any one warrants action):
  • User corrected your style, tone, format, legibility, or verbosity. Frustration signals ('stop doing X', 'this is too verbose', 'just give me the answer', 'why are you explaining') or an explicit 'remember this' are FIRST-CLASS skill signals, not just memory signals. Update the relevant skill(s) to embed the preference so the next session starts already knowing.
  • User corrected your workflow, approach, or sequence of steps. Encode the correction as a pitfall or explicit step in the skill that governs that class of task.
  • Non-trivial technique, fix, workaround, debugging path, or tool-usage pattern emerged that a future session would benefit from.
  • A skill that was loaded or consulted this session turned out wrong, missing a step, or outdated. Patch it NOW.

Preference order — pick the earliest action that fits:
  1. UPDATE A CURRENTLY-LOADED SKILL. If the new learning extends a skill that was loaded via /skill-name or skill_view this session, PATCH that one first.
  2. UPDATE AN EXISTING UMBRELLA (skills_list + skill_view). If no loaded skill fits but an existing class-level skill does, patch it.
  3. ADD A SUPPORT FILE under an existing umbrella via skill_manage action=write_file:
     • \`references/<topic>.md\` — session-specific detail, error transcripts, API quirks, condensed knowledge notes
     • \`templates/<name>.<ext>\` — starter files meant to be copied and modified
     • \`scripts/<name>.<ext>\` — statically re-runnable actions (verification, fixtures, probes)
     Add a one-line pointer in SKILL.md so future agents find them.
  4. CREATE A NEW CLASS-LEVEL UMBRELLA when nothing existing fits. Name at the class level — NOT a PR number, error string, codename, or 'fix-X / debug-Y' session artifact.

Do NOT capture as skills (these become persistent self-imposed constraints):
  • Environment-dependent failures (missing binaries, fresh-install errors, unconfigured credentials).
  • Negative claims about tools ('browser tools do not work', 'X is broken').
  • Session-specific transient errors that resolved before the conversation ended.
  • One-off task narratives ('summarize today's market').

If a tool failed because of setup state, capture the FIX (install command, config step, env var) under an existing setup or troubleshooting skill — never 'this tool does not work' as a standalone constraint.

'Nothing to save.' is a real option but should NOT be the default. Act when signals fire.`;

export const COMBINED_REVIEW_PROMPT = `Review the conversation above and update two things:

**Memory**: who the user is. Did the user reveal persona, desires, preferences, personal details, or expectations about how you should behave? Save facts and durable preferences with the memory tool.

**Skills**: how to do this class of task. Be ACTIVE — most sessions produce at least one skill update. A pass that does nothing is a missed learning opportunity.

Target shape: CLASS-LEVEL skills with rich SKILL.md + \`references/\` support files. Not narrow one-session-one-skill entries.

Skill signals (any one is enough):
  • User corrected your style, tone, format, or approach. FIRST-CLASS skill signal.
  • Non-trivial technique, fix, or workaround emerged.
  • A loaded skill turned out wrong or outdated — patch it now.

Skill action preference order:
  1. PATCH a currently-loaded skill.
  2. PATCH an existing umbrella.
  3. ADD a support file (references/ templates/ scripts/) under an existing umbrella.
  4. CREATE a new class-level umbrella only if nothing existing fits.

User-preference lessons belong in BOTH memory AND the skill governing that task.

Do NOT capture: environment failures, negative tool claims, transient errors, one-off narratives.

If genuinely nothing stands out, say 'Nothing to save.' — but don't default to it.`;

export interface BackgroundReviewOptions {
  memoryIntervalTurns?: number;
  skillIntervalIters?: number;
  /** Invoked with a one-line summary after a review completes with actions. */
  onSummary?: (message: string) => void;
  /** Disable review entirely (e.g. when running as a sub-agent already). */
  disabled?: boolean;
}

/** Factory for the Agent class — avoids circular import with agent.ts */
export interface ReviewAgentSpawner {
  spawn(args: {
    messagesSnapshot: Message[];
    prompt: string;
    tools: ToolDef[];
  }): Promise<{ toolCalls: Array<{ name: string; result: string }> }>;
}

export class BackgroundReview {
  private turnsSinceMemory = 0;
  private itersSinceSkill = 0;
  private memoryInterval: number;
  private skillInterval: number;
  private onSummary?: (message: string) => void;
  private disabled: boolean;
  private running = false;

  constructor(opts: BackgroundReviewOptions = {}) {
    this.memoryInterval = opts.memoryIntervalTurns ?? DEFAULT_MEMORY_INTERVAL;
    this.skillInterval = opts.skillIntervalIters ?? DEFAULT_SKILL_INTERVAL;
    this.onSummary = opts.onSummary;
    this.disabled = opts.disabled ?? false;
  }

  /** Replay history to rebuild counters after resume/restart */
  hydrateFromHistory(messages: Message[]): void {
    let userTurns = 0;
    for (const msg of messages) {
      if (msg.role === "user") userTurns++;
    }
    // Mirror Hermes: %= interval keeps the original 1-in-N cadence on resume
    // instead of firing immediately if we happen to land past a multiple of N.
    if (this.memoryInterval > 0) {
      this.turnsSinceMemory = userTurns % this.memoryInterval;
    }
  }

  /** Call on every user turn */
  onUserTurn(): void {
    this.turnsSinceMemory++;
  }

  /** Call on every assistant tool call */
  onToolCall(name: string): void {
    this.itersSinceSkill++;
    // Reset counters when the relevant tool was actually used this turn
    if (name === "memory") this.turnsSinceMemory = 0;
    if (name === "skill_manage") this.itersSinceSkill = 0;
  }

  /** Returns which reviews (if any) should fire now. Consumes the counters. */
  checkAndReset(): { memory: boolean; skill: boolean } {
    if (this.disabled) return { memory: false, skill: false };
    const memory = this.memoryInterval > 0 && this.turnsSinceMemory >= this.memoryInterval;
    const skill = this.skillInterval > 0 && this.itersSinceSkill >= this.skillInterval;
    if (memory) this.turnsSinceMemory = 0;
    if (skill) this.itersSinceSkill = 0;
    return { memory, skill };
  }

  /** Run review fork — non-blocking. Caller should `void` the result. */
  async run(
    spawner: ReviewAgentSpawner,
    messagesSnapshot: Message[],
    parentTools: ToolDef[],
    which: { memory: boolean; skill: boolean },
  ): Promise<void> {
    if (this.running) return;
    if (!which.memory && !which.skill) return;

    const prompt = which.memory && which.skill
      ? COMBINED_REVIEW_PROMPT
      : which.memory
        ? MEMORY_REVIEW_PROMPT
        : SKILL_REVIEW_PROMPT;

    const tools = parentTools.filter((t) => REVIEW_TOOLSET.has(t.name));
    if (tools.length === 0) return;

    this.running = true;
    try {
      const result = await spawner.spawn({
        messagesSnapshot,
        prompt,
        tools,
      });
      const actions = summarizeReviewActions(result.toolCalls);
      if (actions.length > 0 && this.onSummary) {
        this.onSummary(`Self-improvement review: ${actions.join(" · ")}`);
      }
    } catch {
      // Background review is best-effort — never surface errors to user
    } finally {
      this.running = false;
    }
  }

  /** Build child AgentConfig that inherits parent's runtime but restricts tools and prompt */
  static buildChildConfig(
    parentConfig: AgentConfig,
    prompt: string,
    tools: ToolDef[],
  ): AgentConfig {
    return {
      ...parentConfig,
      systemPrompt: `You are a background self-improvement reviewer. You MUST NOT spawn sub-agents. Focus only on the review task.\n\n${prompt}`,
      maxTurns: 8,
      tools,
      skills: { ctf: false },
      // Disable nested review in the child
    } as AgentConfig;
  }
}

/** Extract human-readable action labels from a review fork's tool calls. */
export function summarizeReviewActions(
  toolCalls: Array<{ name: string; result: string }>,
): string[] {
  const actions: string[] = [];
  for (const tc of toolCalls) {
    const result = tc.result || "";
    const lower = result.toLowerCase();
    if (tc.name === "skill_manage") {
      // skill_manage returns strings like "Skill 'xxx' created and persisted to disk."
      const created = result.match(/Skill '([^']+)' created/);
      const updated = result.match(/Skill '([^']+)' (?:updated|patched)/);
      if (created) actions.push(`skill_created=${created[1]}`);
      else if (updated) actions.push(`skill_updated=${updated[1]}`);
    } else if (tc.name === "memory") {
      if (lower.includes("added") || lower.includes("saved") || lower.includes("remembered")) {
        actions.push("memory_updated");
      }
    }
  }
  // De-dupe while preserving order
  return [...new Set(actions)];
}
