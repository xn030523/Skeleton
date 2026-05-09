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
import type { Agent, MemoryStore, UserProfile, SessionDB, CronStore, CommandContext } from "@skeleton/core";
import {
  formatToolCompletion, formatToolInProgress,
  processCommandAsync,
} from "@skeleton/core";
import { formatTokenCount, buildContextBar, contextBarColor } from "./theme.js";
import { InkAdapter } from "./output-adapter.js";

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
  const lastToolNameRef = useRef("");
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

  /** Build a progressMode-aware onToolComplete callback */
  const buildToolCompleteHandler = useCallback(() => {
    return (info: { name: string; args: Record<string, unknown>; duration: number; isError: boolean; resultPreview: string }) => {
      const mode = agent.progressMode;
      // "off": no tool output at all
      if (mode === "off") {
        setCtxProgress(agent.getContextProgress());
        return;
      }
      // "new": skip if same tool as last time
      if (mode === "new" && info.name === lastToolNameRef.current) {
        lastToolNameRef.current = info.name;
        setCtxProgress(agent.getContextProgress());
        return;
      }
      lastToolNameRef.current = info.name;

      const line = formatToolCompletion(info.name, info.args, info.duration, {
        isError: info.isError, useColor: true,
      });
      addLine("  " + line);

      // "verbose": also show args and result preview
      if (mode === "verbose") {
        addLine(chalk.gray(`    args: ${JSON.stringify(info.args).slice(0, 300)}`));
        if (info.resultPreview) {
          addLine(chalk.gray(`    result: ${info.resultPreview}`));
        }
      }
      setCtxProgress(agent.getContextProgress());
    };
  }, [agent, addLine]);

  // Build the command context for the shared processor
  const cmdCtx = useCallback((): CommandContext => ({
    agent,
    memory,
    sessionDb,
    cronStore,
    config,
    userProfile,
  }), [agent, memory, sessionDb, cronStore, config, userProfile]);

  // Build ink output adapter
  const inkAdapter = useCallback((): InkAdapter => {
    const streamCb = (token: string) => {
      // no-op placeholder — real streaming handled in handleSubmit
    };
    return new InkAdapter(addLine, addLines, setOutput, setInput, onQuit, agent, streamCb);
  }, [agent, addLine, addLines, onQuit]);

  // Main submit handler
  const handleSubmit = useCallback(async (text: string) => {
    if (!text.trim() || isProcessing.current) return;
    const trimmed = text.trim();

    if (trimmed.startsWith("/")) {
      setInput("");

      // Use shared command processor
      const adapter = inkAdapter();
      const ctx = cmdCtx();

      // For skill commands, use the full streaming UI path
      const parts = trimmed.split(/\s+/);
      const skillName = parts[0].replace(/^\/+/, "");
      const skillReg = agent.getSkillRegistry();
      const skill = skillReg?.get(skillName);
      if (skill?.userInvocable) {
        // Skill slash — full streaming UI (same as normal chat)
        isProcessing.current = true;
        addLine(chalk.cyan(`  ⚡ Skill: ${skill.name}`));
        setStreaming(true);
        setThinking(true);
        setStreamText("");

        agent.onToolCall = (name, args) => { setCtxProgress(agent.getContextProgress()); };
        agent.onToolComplete = buildToolCompleteHandler();
        agent.onToolResult = () => {};

        let firstToken = true;
        let accumulated = "";
        try {
          const result = await agent.runStream(trimmed, (token) => {
            const safeToken = String(token ?? "");
            if (firstToken) { setThinking(false); firstToken = false; }
            accumulated += safeToken;
            setStreamText(accumulated);
          });
          if (firstToken) accumulated = result ?? "";
          const headerLine = chalk.magenta("◆") + chalk.gray(" Skeleton");
          addLines([headerLine, accumulated, chalk.gray("─".repeat(60))]);
        } catch (err) {
          addLine(chalk.red(`  ✗ ${(err as Error).message}`));
        } finally {
          setStreaming(false);
          setStreamText("");
          setThinking(false);
          isProcessing.current = false;
          setCtxProgress(agent.getContextProgress());
        }
        return;
      }

      // Regular slash commands — delegate to shared processor
      await processCommandAsync(trimmed, ctx, adapter);

      // Check if command was quit
      const resolved = (await import("@skeleton/core")).resolveCommand(parts[0]);
      if (resolved?.name === "quit" || resolved?.name === "exit") {
        exit();
      }
      return;
    }

    isProcessing.current = true;
    addLine(chalk.green("❯") + " " + trimmed);
    setInput("");
    setStreaming(true);
    setThinking(true);
    setStreamText("");

    // Wire tool call callbacks — progressMode-aware (Task 5)
    agent.onToolCall = (name, args) => {
      const preview = formatToolInProgress(name, args);
      setCtxProgress(agent.getContextProgress());
    };
    agent.onToolComplete = buildToolCompleteHandler();
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
  }, [agent, addLine, addLines, cmdCtx, inkAdapter]);

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

      {/* Status bar — density controlled by agent.statusBarMode */}
      <Box borderStyle="single" borderColor="gray" paddingLeft={1} paddingRight={1}>
        <Text color="magenta">◆</Text>
        <Text> </Text>
        <Text color="cyan">{shortModel}</Text>
        {agent.statusBarMode !== "compact" && (
          <>
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
          </>
        )}
        {agent.statusBarMode === "detailed" && (
          <>
            <Text color="gray"> │ </Text>
            <Text color="blue">P:{agent.getPersonality().getActiveName()}</Text>
            <Text color="gray"> │ </Text>
            <Text color="magenta">S:{agent.skin.getActiveName()}</Text>
            {ctxProgress && (
              <Text color="gray"> │ {formatTokenCount(ctxProgress.usedTokens)}</Text>
            )}
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
