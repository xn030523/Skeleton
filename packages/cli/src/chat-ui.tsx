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
import { render, Box, Text, Static, useInput, useApp } from "ink";
import chalk from "chalk";
import type { Agent, MemoryStore, UserProfile, SessionDB, CronStore, CommandContext } from "@skeleton/core";
import {
  formatToolCompletion, formatToolInProgress,
  processCommandAsync,
  renderMarkdown,
  COMMAND_REGISTRY,
  listAllCommandNames,
} from "@skeleton/core";
import { formatTokenCount, buildContextBar, contextBarColor } from "./theme.js";
import { InkAdapter } from "./output-adapter.js";
import { SessionPicker, type PickerItem } from "./session-picker.js";

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
  // Append-only log: Ink's <Static> requires items that only grow, never
  // replaced or truncated. Each entry keeps a monotonic id so React keys
  // are stable across renders (claude-code pattern).
  const [output, setOutput] = useState<{ id: number; line: string }[]>([]);
  const outputSeqRef = useRef(0);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [ctxProgress, setCtxProgress] = useState<{ usedTokens: number; contextWindow: number; percent: number } | null>(null);
  const lastToolNameRef = useRef("");
  const isProcessing = useRef(false);
  const [pickerItems, setPickerItems] = useState<PickerItem[] | null>(null);

  const addLine = useCallback((line: string) => {
    setOutput(prev => [...prev, { id: ++outputSeqRef.current, line }]);
  }, []);

  const addLines = useCallback((lines: string[]) => {
    setOutput(prev => {
      const next = prev.slice();
      for (const line of lines) next.push({ id: ++outputSeqRef.current, line });
      return next;
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
    const clearOutput = () => setOutput([]);
    return new InkAdapter(addLine, addLines, clearOutput, setInput, onQuit, agent, streamCb);
  }, [agent, addLine, addLines, onQuit]);

  // Main submit handler
  const handleSubmit = useCallback(async (text: string) => {
    if (!text.trim() || isProcessing.current) return;
    const trimmed = text.trim();

    if (trimmed.startsWith("/")) {
      setInput("");

      // ── /resume without args → interactive session picker ──
      const resumeParts = trimmed.split(/\s+/);
      const resumeCmd = resumeParts[0].replace(/^\/+/, "").toLowerCase();
      if ((resumeCmd === "resume" || resumeCmd === "continue") && !resumeParts[1]) {
        const items: PickerItem[] = [];
        // Branches first
        for (const b of agent.listBranches()) {
          items.push({ id: `branch:${b}`, label: b, detail: "branch", type: "branch" });
        }
        // Recent sessions
        const sessions = sessionDb.recentSessions(15);
        for (const s of sessions) {
          const raw = s as any;
          const title = raw.title
            || (raw.first_user_msg ? raw.first_user_msg.replace(/\n/g, " ").slice(0, 40) : null)
            || raw.id?.slice(0, 24)
            || "untitled";
          const date = (raw.created_at || raw.createdAt || "").slice(0, 16);
          const msgCount = raw.message_count ?? raw.messageCount ?? 0;
          items.push({
            id: `session:${raw.id}`,
            label: title,
            detail: `${msgCount} msgs  ${date}`,
            type: "session",
          });
        }
        setPickerItems(items);
        return;
      }

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
          const rendered = renderMarkdown(accumulated);
          addLines([headerLine, rendered, chalk.gray("─".repeat(60))]);
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

      // Commit output — render markdown so **bold**, headings, lists,
      // inline code, and LaTeX all render as styled ANSI rather than
      // showing raw markers like "**text**".
      const headerLine = chalk.magenta("◆") + chalk.gray(" Skeleton");
      const rendered = renderMarkdown(accumulated);
      addLines([headerLine, rendered, chalk.gray("─".repeat(60))]);
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

  const [selectedCmd, setSelectedCmd] = useState(0);

  // Key input handler
  useInput((ch, key) => {
    if (isProcessing.current || pickerItems !== null) return;

    if (key.return) {
      // If command suggestions are visible and one is selected, fill it in
      if (input.startsWith("/") && !input.includes(" ")) {
        const partial = input.slice(1).toLowerCase();
        const matches = partial
          ? COMMAND_REGISTRY.filter(c => c.name.startsWith(partial))
          : COMMAND_REGISTRY;
        if (matches.length > 0 && selectedCmd < matches.length) {
          const chosen = matches[selectedCmd];
          if (chosen && input !== "/" + chosen.name) {
            setInput("/" + chosen.name);
            setSelectedCmd(0);
            return;
          }
        }
      }
      handleSubmit(input);
      setSelectedCmd(0);
    } else if (key.tab) {
      // Tab: fill in selected command
      if (input.startsWith("/")) {
        const partial = input.slice(1).toLowerCase();
        const matches = partial
          ? COMMAND_REGISTRY.filter(c => c.name.startsWith(partial))
          : COMMAND_REGISTRY;
        if (matches.length > 0 && selectedCmd < matches.length) {
          setInput("/" + matches[selectedCmd].name);
          setSelectedCmd(0);
        }
      }
    } else if (key.upArrow && input.startsWith("/") && !input.includes(" ")) {
      setSelectedCmd(prev => Math.max(0, prev - 1));
    } else if (key.downArrow && input.startsWith("/") && !input.includes(" ")) {
      const partial = input.slice(1).toLowerCase();
      const count = partial
        ? COMMAND_REGISTRY.filter(c => c.name.startsWith(partial)).length
        : COMMAND_REGISTRY.length;
      setSelectedCmd(prev => Math.min(count - 1, prev + 1));
    } else if (key.backspace) {
      setInput(prev => prev.slice(0, -1));
      setSelectedCmd(0);
    } else if (key.escape) {
      if (input.startsWith("/")) {
        setInput("");
        setSelectedCmd(0);
      }
    } else if (ch && !key.ctrl && !key.meta) {
      setInput(prev => {
        const next = prev + ch;
        return next.length > 500 ? next.slice(0, 500) : next;
      });
      setSelectedCmd(0);
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

  // Short model name for status bar
  const shortModel = model.length > 30 ? model.slice(0, 27) + "..." : model;

  // ── Session picker overlay ──
  if (pickerItems !== null) {
    return (
      <Box flexDirection="column">
        <SessionPicker
          items={pickerItems}
          onSelect={(item) => {
            setPickerItems(null);
            if (item.type === "branch") {
              const ok = agent.resumeBranch(item.id.replace("branch:", ""));
              if (ok) {
                addLine(chalk.green(`  ✓ Resumed branch "${item.label}"`));
                addLine(chalk.gray("─".repeat(60)));
              } else {
                addLine(chalk.red(`  ✗ Failed to resume "${item.label}"`));
              }
            } else {
              // Session resume — load messages and render history
              const sid = item.id.replace("session:", "");
              const messages = sessionDb.getMessages(sid);
              if (messages.length === 0) {
                addLine(chalk.gray(`  No messages in session "${item.label}".`));
                return;
              }

              // Render conversation history
              addLine(chalk.cyan("  ┌─ Previous Conversation ─────────────────────────"));
              for (const msg of messages) {
                if (msg.role === "user") {
                  const preview = (msg.content || "").replace(/\n/g, " ").slice(0, 120);
                  addLine(chalk.green("  │ ❯ ") + preview);
                } else if (msg.role === "assistant") {
                  const preview = (msg.content || "").replace(/\n/g, " ").slice(0, 120);
                  addLine(chalk.magenta("  │ ◆ ") + preview);
                } else if (msg.role === "tool") {
                  const toolName = (msg as any).toolName || (msg as any).tool_name || "tool";
                  addLine(chalk.gray(`  │   ┊ ${toolName}`));
                }
              }
              addLine(chalk.cyan("  └──────────────────────────────────────────────────"));
              addLine("");

              // Inject history into agent so next message continues the conversation
              agent.loadMessages(messages);
              addLine(chalk.green(`  ✓ Resumed session "${item.label}" (${messages.length} messages)`));
              addLine(chalk.gray("─".repeat(60)));
            }
          }}
          onCancel={() => {
            setPickerItems(null);
            addLine(chalk.gray("  Resume cancelled."));
          }}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Output area — finished lines rendered ONCE via <Static> so they
          never re-render and the terminal doesn't scroll-jump on every
          stream token. Only the streaming preview at the bottom updates. */}
      <Static items={output}>
        {(item) => (
          <Box key={`out-${item.id}`} flexDirection="column">
            {item.line.split("\n").map((sub, j) => (
              <Text key={`out-${item.id}-${j}`}>{sub}</Text>
            ))}
          </Box>
        )}
      </Static>

      {/* Live streaming preview — the only thing that updates per token */}
      <Box flexDirection="column" marginBottom={1}>
        {streamText && streamText.split("\n").map((sub, j) => (
          <Text key={`stream-${j}`}>{sub}</Text>
        ))}
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

      {/* Slash command suggestions — vertical list like Claude Code */}
      {input.startsWith("/") && !isProcessing.current && (() => {
        const hasSpace = input.includes(" ");
        const partial = input.slice(1).toLowerCase();

        // Sub-command / argument completion (after space)
        if (hasSpace) {
          const cmdName = partial.split(/\s+/)[0];
          const argPartial = input.slice(input.indexOf(" ") + 1).toLowerCase();
          let argItems: { name: string; desc: string }[] = [];

          if (cmdName === "resume" || cmdName === "branch") {
            const branches = agent.listBranches();
            argItems = branches
              .filter(b => !argPartial || b.toLowerCase().startsWith(argPartial))
              .map(b => ({ name: b, desc: "branch" }));
          } else if (cmdName === "sessions") {
            // Show subcommands
            argItems = [
              { name: "list", desc: "Browse past sessions" },
              { name: "search", desc: "Search sessions by keyword" },
            ].filter(s => !argPartial || s.name.startsWith(argPartial));
          } else if (cmdName === "verbose") {
            argItems = ["off", "new", "all", "verbose"]
              .filter(s => !argPartial || s.startsWith(argPartial))
              .map(s => ({ name: s, desc: "" }));
          } else if (cmdName === "snapshot") {
            argItems = ["create", "restore", "list", "prune"]
              .filter(s => !argPartial || s.startsWith(argPartial))
              .map(s => ({ name: s, desc: "" }));
          } else if (cmdName === "goal") {
            argItems = ["status", "pause", "resume", "clear"]
              .filter(s => !argPartial || s.startsWith(argPartial))
              .map(s => ({ name: s, desc: "" }));
          } else if (cmdName === "plugin") {
            argItems = ["list", "load", "unload", "reload"]
              .filter(s => !argPartial || s.startsWith(argPartial))
              .map(s => ({ name: s, desc: "" }));
          } else if (cmdName === "skin") {
            argItems = ["default", "midnight", "hacker", "sakura", "ocean"]
              .filter(s => !argPartial || s.startsWith(argPartial))
              .map(s => ({ name: s, desc: "theme" }));
          } else if (cmdName === "lang") {
            argItems = ["en", "zh", "ja", "ko", "de", "es", "fr", "tr", "uk"]
              .filter(s => !argPartial || s.startsWith(argPartial))
              .map(s => ({ name: s, desc: "" }));
          }

          if (argItems.length === 0) return null;
          const maxLen = Math.max(...argItems.map(a => a.name.length));
          return (
            <Box flexDirection="column" paddingLeft={2} marginBottom={0}>
              {argItems.slice(0, 10).map((item, i) => (
                <Text key={item.name} dimColor={i !== 0}>
                  <Text color={i === 0 ? "cyan" : "white"} bold={i === 0}>
                    {item.name.padEnd(maxLen + 2)}
                  </Text>
                  {item.desc && <Text color="gray">{item.desc}</Text>}
                </Text>
              ))}
            </Box>
          );
        }

        // Top-level command completion
        const matches = partial
          ? COMMAND_REGISTRY.filter(c => c.name.startsWith(partial)).slice(0, 12)
          : COMMAND_REGISTRY.slice(0, 12);
        if (matches.length === 0) return null;
        const maxNameLen = Math.max(...matches.map(c => c.name.length));
        return (
          <Box flexDirection="column" paddingLeft={2} marginBottom={0}>
            {matches.map((cmd, i) => {
              const isSelected = i === selectedCmd;
              const padded = cmd.name.padEnd(maxNameLen + 2);
              return (
                <Text key={cmd.name} dimColor={!isSelected}>
                  <Text color={isSelected ? "cyan" : "white"} bold={isSelected}>
                    {`/${padded}`}
                  </Text>
                  <Text color="gray">{cmd.description}</Text>
                </Text>
              );
            })}
          </Box>
        );
      })()}

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
