/**
 * Skeleton CLI — ink-based interactive chat with fixed input area.
 *
 * Layout (inspired by Hermes prompt_toolkit approach):
 *   ┌─ output area (scrollable) ─────────────────┐
 *   │  ◆ Skeleton                                 │
 *   │  AI response text...                        │
 *   │    ┊ tool_name {"arg":"val"}                 │
 *   │    ┊ ✓ result preview                        │
 *   ├──────────────────────────────────────────────┤
 *   │ ❯ user types here_                           │
 *   └──────────────────────────────────────────────┘
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import chalk from "chalk";
import type { Agent, MemoryStore, UserProfile, SessionDB, CronStore } from "@skeleton/core";
import { formatToolCompletion, formatToolInProgress } from "@skeleton/core";
import { formatTokenCount, buildContextBar, contextBarColor } from "./theme.js";

interface ChatUIProps {
  agent: Agent;
  model: string;
  toolCount: number;
  mcpCount: number;
  memory: MemoryStore;
  userProfile: UserProfile;
  sessionDb: SessionDB;
  cronStore: CronStore;
  config: { llm: { protocol: string; model: string; baseUrl: string } };
  onQuit: () => Promise<void>;
}

export function ChatUI({
  agent, model, toolCount, mcpCount,
  memory, userProfile, sessionDb, cronStore, config,
  onQuit,
}: ChatUIProps) {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [output, setOutput] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [ctxProgress, setCtxProgress] = useState<{ usedTokens: number; contextWindow: number; percent: number } | null>(null);
  const maxLines = 500;
  const isProcessing = useRef(false);

  const addLine = useCallback((line: string) => {
    setOutput(prev => {
      const next = [...prev, line];
      return next.length > maxLines ? next.slice(-maxLines) : next;
    });
  }, []);

  const addLines = useCallback((lines: string[]) => {
    setOutput(prev => {
      const next = [...prev, ...lines];
      return next.length > maxLines ? next.slice(-maxLines) : next;
    });
  }, []);

  // Slash command handler
  const handleSlashCommand = useCallback((cmd: string): boolean => {
    const parts = cmd.split(/\s+/);
    const base = parts[0];

    switch (base) {
      case "/quit":
      case "/exit":
        onQuit().then(() => exit());
        return true;

      case "/new":
        agent.reset();
        addLine(chalk.green("✓ New session."));
        addLine(chalk.gray("─".repeat(60)));
        return true;

      case "/reset":
        agent.reset();
        addLine(chalk.gray("✓ Conversation reset."));
        return true;

      case "/history": {
        const history = agent.getHistory();
        if (history.length === 0) {
          addLine(chalk.gray("  (empty)"));
        } else {
          for (const msg of history) {
            const rc: Record<string, { glyph: string; style: typeof chalk.green }> = {
              user: { glyph: "❯", style: chalk.green },
              assistant: { glyph: "◆", style: chalk.magenta },
              tool: { glyph: "┊", style: chalk.gray },
            };
            const r = rc[msg.role] ?? { glyph: "·", style: chalk.gray };
            const limit = msg.role === "tool" ? 100 : 200;
            addLine(`  ${r.style(r.glyph)} ${(msg.content ?? "").slice(0, limit)}`);
          }
        }
        return true;
      }

      case "/model":
        addLine(chalk.gray(`  ${config.llm.protocol} | ${config.llm.model}`));
        addLine(chalk.gray(`  Base: ${config.llm.baseUrl}`));
        return true;

      case "/memory": {
        const all = memory.list();
        if (all.length === 0) {
          addLine(chalk.gray("  No memories yet."));
        } else {
          for (const m of all) {
            addLine(`  ${chalk.yellow(`[${m.category}]`)} ${m.content.slice(0, 120)}`);
          }
        }
        return true;
      }

      case "/remember":
        if (parts[1]) {
          memory.add(parts.slice(1).join(" "), "user", "manual");
          addLine(chalk.green("✓ Saved to memory."));
        }
        return true;

      case "/forget":
        if (parts[1]) {
          const removed = memory.remove(parts.slice(1).join(" "));
          addLine(chalk.gray(`✓ Removed ${removed} memory(ies).`));
        }
        return true;

      case "/search":
        if (parts[1]) {
          const results = sessionDb.search(parts.slice(1).join(" "));
          if (results.length === 0) {
            addLine(chalk.gray("  No results."));
          } else {
            for (const r of results) {
              addLine(`  ${chalk.gray(`[${r.role}]`)} ${r.content.slice(0, 150)}`);
            }
          }
        }
        return true;

      case "/tools": {
        const registry = agent.getToolRegistry();
        const toolList = registry.list();
        if (toolList.length === 0) {
          addLine(chalk.gray("  No tools registered."));
        } else {
          for (const t of toolList) {
            addLine(`  ${chalk.cyan(t.name)} — ${t.description.slice(0, 80)}`);
          }
        }
        return true;
      }

      case "/usage": {
        const usage = agent.getUsage();
        const ctx = agent.getContextProgress();
        addLine(chalk.cyan("  Last turn:"));
        addLine(`    Prompt: ${usage.last.promptTokens} | Completion: ${usage.last.completionTokens}`);
        addLine(chalk.cyan("  Session total:"));
        addLine(`    Prompt: ${usage.total.promptTokens} | Completion: ${usage.total.completionTokens} | Turns: ${usage.total.turns}`);
        addLine(chalk.cyan("  Context window:"));
        addLine(`    ${formatTokenCount(ctx.usedTokens)}/${formatTokenCount(ctx.contextWindow)} ${buildContextBar(ctx.percent, 12)} ${ctx.percent}%`);
        return true;
      }

      case "/undo": {
        const ok = agent.undoLastTurn();
        addLine(ok ? chalk.green("  ✓ Last turn undone.") : chalk.gray("  Nothing to undo."));
        return true;
      }

      case "/compress":
        // Async — fire and show result when done
        agent.compress().then(msg => addLine(chalk.green(`  ✓ ${msg}`))).catch(err => addLine(chalk.red(`  ✗ ${err.message}`)));
        addLine(chalk.gray("  Compressing..."));
        return true;

      case "/goal": {
        const sub = parts[1];
        if (!sub || sub === "status") {
          const goal = agent.getGoal();
          if (!goal) {
            addLine(chalk.gray("  No active goal. Usage: /goal <text> to set one."));
          } else {
            addLine(chalk.cyan(`  Goal: ${goal.goal}`));
            addLine(chalk.gray(`  Status: ${goal.status} | Turns: ${goal.turnsUsed}/${goal.maxTurns}`));
            if (goal.lastVerdict) {
              addLine(chalk.gray(`  Last verdict: ${goal.lastVerdict} — ${goal.lastReason ?? ""}`));
            }
            if (goal.pausedReason) {
              addLine(chalk.yellow(`  Paused: ${goal.pausedReason}`));
            }
          }
        } else if (sub === "pause") {
          agent.pauseGoal("user paused");
          addLine(chalk.yellow("  ⏸ Goal paused."));
        } else if (sub === "resume") {
          const ok = agent.resumeGoal();
          addLine(ok ? chalk.green("  ▶ Goal resumed.") : chalk.gray("  No paused goal to resume."));
        } else if (sub === "clear") {
          agent.clearGoal();
          addLine(chalk.gray("  ✓ Goal cleared."));
        } else {
          // Set new goal
          const goalText = parts.slice(1).join(" ");
          agent.setGoal(goalText);
          addLine(chalk.green(`  ✓ Goal set: ${goalText}`));
          addLine(chalk.gray("  Agent will continue working toward this goal across turns."));
          addLine(chalk.gray("  Use /goal status, /goal pause, /goal resume, or /goal clear."));
        }
        return true;
      }

      default:
        addLine(chalk.yellow(`  Unknown: ${cmd}`));
        return true;
    }
  }, [agent, memory, sessionDb, config, addLine, exit, onQuit]);

  // Main submit handler
  const handleSubmit = useCallback(async (text: string) => {
    if (!text.trim() || isProcessing.current) return;
    const trimmed = text.trim();

    if (trimmed.startsWith("/")) {
      handleSlashCommand(trimmed);
      setInput("");
      return;
    }

    isProcessing.current = true;
    addLine(chalk.green("❯") + " " + trimmed);
    setInput("");
    setStreaming(true);
    setThinking(true);
    setStreamText("");

    // Wire tool call callbacks — use new pretty output format (Hermes-style)
    agent.onToolCall = (name, args) => {
      // Show in-progress indicator (will be replaced by completion line)
      const preview = formatToolInProgress(name, args);
      setCtxProgress(agent.getContextProgress());
    };
    agent.onToolComplete = (info) => {
      // Single pretty-formatted line: ┊ 🔍 search    "query"  0.8s
      const line = formatToolCompletion(info.name, info.args, info.duration, {
        isError: info.isError,
        useColor: true,
      });
      addLine("  " + line);
      setCtxProgress(agent.getContextProgress());
    };
    // Keep legacy onToolResult as a no-op (onToolComplete supersedes it)
    agent.onToolResult = () => {};

    let firstToken = true;
    let accumulated = "";

    try {
      const result = await agent.runStream(trimmed, (token) => {
        const safeToken = String(token ?? "");
        if (firstToken) {
          setThinking(false);
          firstToken = false;
        }
        accumulated += safeToken;
        setStreamText(accumulated);
      });

      if (firstToken) {
        accumulated = result ?? "";
      }

      // Commit output
      const headerLine = chalk.magenta("◆") + chalk.gray(" Skeleton");
      addLines([headerLine, accumulated, chalk.gray("─".repeat(60))]);
    } catch (err) {
      const msg = (err as Error).message;
      addLine(chalk.red(`  ✗ ${msg}`));
    } finally {
      setStreaming(false);
      setStreamText("");
      setThinking(false);
      isProcessing.current = false;
      setCtxProgress(agent.getContextProgress());
    }
  }, [agent, addLine, addLines, handleSlashCommand]);

  // Key input handler
  useInput((ch, key) => {
    if (isProcessing.current) return;

    if (key.return) {
      handleSubmit(input);
    } else if (key.backspace) {
      setInput(prev => prev.slice(0, -1));
    } else if (ch && !key.ctrl && !key.meta) {
      setInput(prev => {
        const next = prev + ch;
        return next.length > 500 ? next.slice(0, 500) : next; // Max input length
      });
    }
  });

  // Periodically refresh context progress during streaming (Hermes-style live update)
  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => {
      setCtxProgress(agent.getContextProgress());
    }, 1000);
    return () => clearInterval(timer);
  }, [streaming, agent]);

  // Visible output lines (show last N lines fitting in terminal)
  const visibleLines = output.slice(-40);

  // Short model name for status bar
  const shortModel = model.length > 30 ? model.slice(0, 27) + "..." : model;

  return (
    <Box flexDirection="column">
      {/* Output area */}
      <Box flexDirection="column" marginBottom={1}>
        {visibleLines.map((line, i) => (
          <Text key={`out-${i}-${line.slice(0,20)}`}>{line}</Text>
        ))}
        {streamText && <Text key="stream">{streamText}</Text>}
        {thinking && !streamText && (
          <Text key="thinking" color="cyan">  ⏳ Thinking...</Text>
        )}
      </Box>

      {/* Status bar — persistent info line with context progress (Hermes-style) */}
      <Box borderStyle="single" borderColor="gray" paddingLeft={1} paddingRight={1}>
        <Text color="magenta">◆</Text>
        <Text> </Text>
        <Text color="cyan">{shortModel}</Text>
        <Text color="gray"> │ </Text>
        <Text color="green">T:{toolCount}</Text>
        <Text color="gray"> │ </Text>
        <Text color="yellow">M:{mcpCount}</Text>
        {ctxProgress && (
          <>
            <Text color="gray"> │ </Text>
            <Text color={contextBarColor(ctxProgress.percent)}>
              {buildContextBar(ctxProgress.percent, 8)}
            </Text>
            <Text> </Text>
            <Text color="gray">
              {formatTokenCount(ctxProgress.usedTokens)}/{formatTokenCount(ctxProgress.contextWindow)}
            </Text>
            <Text color={contextBarColor(ctxProgress.percent)}>
              {" "}{ctxProgress.percent}%
            </Text>
          </>
        )}
        {streaming && <Text color="gray"> │ </Text>}
        {streaming && <Text color="cyan">⏳</Text>}
      </Box>

      {/* Input area — fixed at bottom with box border */}
      <Box borderStyle="round" borderColor="gray" paddingLeft={1} paddingRight={1}>
        <Text color="cyan" bold>❯ </Text>
        <Text>{input}</Text>
        <Text backgroundColor="cyan"> </Text>
      </Box>
    </Box>
  );
}

export function launchChatUI(
  agent: Agent,
  model: string,
  toolCount: number,
  mcpCount: number,
  deps: {
    memory: MemoryStore;
    userProfile: UserProfile;
    sessionDb: SessionDB;
    cronStore: CronStore;
    config: { llm: { protocol: string; model: string; baseUrl: string } };
    onQuit: () => Promise<void>;
  },
): Promise<void> {
  return new Promise((resolve) => {
    render(
      <ChatUI
        agent={agent}
        model={model}
        toolCount={toolCount}
        mcpCount={mcpCount}
        memory={deps.memory}
        userProfile={deps.userProfile}
        sessionDb={deps.sessionDb}
        cronStore={deps.cronStore}
        config={deps.config}
        onQuit={deps.onQuit}
      />
    );
  });
}
