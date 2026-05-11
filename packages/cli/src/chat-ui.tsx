/**
 * Skeleton CLI — fullscreen TUI with ScrollBox + fixed input.
 *
 * Architecture (Claude Code style):
 *   AlternateScreen (fixed terminal height)
 *   ├── ScrollBox (messages area, scrollable, flexGrow=1)
 *   │   ├── Logo header
 *   │   ├── Message rows (⎿ connector)
 *   │   ├── Streaming text preview
 *   │   └── Spinner
 *   └── Bottom (fixed, flexShrink=0)
 *       ├── Command suggestions
 *       └── Input prompt (> )
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  wrappedRender as render,
  Box,
  Text,
  useInput,
  useApp,
} from "@skeleton/ink";
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
  config: { llm: { protocol: string; model: string; baseUrl: string; apiKey: string } };
  onQuit: () => Promise<void>;
}

interface OutputLine {
  id: number;
  text: string;
}

export function ChatUI({
  agent, model, toolCount, mcpCount,
  memory, userProfile, sessionDb, cronStore, config,
  onQuit,
}: ChatUIProps) {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<OutputLine[]>([]);
  const lineSeq = useRef(0);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [selectedCmd, setSelectedCmd] = useState(0);
  const [pickerItems, setPickerItems] = useState<PickerItem[] | null>(null);
  const [modelPickerItems, setModelPickerItems] = useState<PickerItem[] | null>(null);
  const [ctxProgress, setCtxProgress] = useState<{ usedTokens: number; contextWindow: number; percent: number } | null>(null);
  const isProcessing = useRef(false);
  const lastToolNameRef = useRef("");

  // Append a line to output
  const addLine = useCallback((text: string) => {
    setLines(prev => [...prev, { id: ++lineSeq.current, text }]);
  }, []);

  const addLines = useCallback((texts: string[]) => {
    setLines(prev => {
      const next = [...prev];
      for (const t of texts) next.push({ id: ++lineSeq.current, text: t });
      return next;
    });
  }, []);

  // Refresh context progress during streaming
  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => setCtxProgress(agent.getContextProgress()), 1000);
    return () => clearInterval(timer);
  }, [streaming, agent]);

  // Tool complete handler
  const buildToolCompleteHandler = useCallback(() => {
    return (info: { name: string; args: Record<string, unknown>; duration: number; isError: boolean; resultPreview: string }) => {
      const mode = agent.progressMode;
      if (mode === "off") return;
      if (mode === "new" && info.name === lastToolNameRef.current) {
        lastToolNameRef.current = info.name;
        return;
      }
      lastToolNameRef.current = info.name;
      const line = formatToolCompletion(info.name, info.args, info.duration, {
        isError: info.isError, useColor: true,
      });
      addLine(chalk.dim("  ⎿ ") + line);
      setCtxProgress(agent.getContextProgress());
    };
  }, [agent, addLine]);

  // Command context
  const cmdCtx = useCallback((): CommandContext => ({
    agent, memory, sessionDb, cronStore, config, userProfile,
  }), [agent, memory, sessionDb, cronStore, config, userProfile]);

  // Ink adapter
  const inkAdapter = useCallback((): InkAdapter => {
    const clearOutput = () => setLines([]);
    return new InkAdapter(addLine, addLines, clearOutput, setInput, onQuit, agent, () => {});
  }, [agent, addLine, addLines, onQuit]);

  // Submit handler
  const handleSubmit = useCallback(async (text: string) => {
    if (!text.trim() || isProcessing.current) return;
    const trimmed = text.trim();

    if (trimmed.startsWith("/")) {
      setInput("");

      // Model picker
      const cmdParts = trimmed.split(/\s+/);
      const cmdName = cmdParts[0].replace(/^\/+/, "").toLowerCase();
      if (cmdName === "model" && !cmdParts[1]) {
        // Fetch models from API
        const baseUrl = config.llm.baseUrl.replace(/\/$/, "");
        addLine(chalk.gray("  Fetching models..."));
        const apiKey = config.llm.apiKey || "";
        fetch(`${baseUrl}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        }).then(res => res.json()).then((data: any) => {
          const models: string[] = (data?.data ?? data?.models ?? [])
            .map((m: any) => m.id ?? m.name ?? m)
            .filter((m: any) => typeof m === "string");
          if (models.length === 0) {
            addLine(chalk.gray("  No models found."));
            return;
          }
          const currentModel = config.llm.model;
          const items: PickerItem[] = models.map(m => ({
            id: `model:${m}`,
            label: m,
            detail: m === currentModel ? "current" : "",
            type: "session" as const,
          }));
          setModelPickerItems(items);
        }).catch(() => {
          addLine(chalk.red("  Failed to fetch models from API."));
        });
        return;
      }

      // Resume picker
      const resumeParts = trimmed.split(/\s+/);
      const resumeCmd = resumeParts[0].replace(/^\/+/, "").toLowerCase();
      if ((resumeCmd === "resume" || resumeCmd === "continue") && !resumeParts[1]) {
        const items: PickerItem[] = [];
        for (const b of agent.listBranches()) {
          items.push({ id: `branch:${b}`, label: b, detail: "branch", type: "branch" });
        }
        const sessions = sessionDb.recentSessions(15);
        for (const s of sessions) {
          const raw = s as any;
          const title = raw.title
            || (raw.first_user_msg ? raw.first_user_msg.replace(/\n/g, " ").slice(0, 40) : null)
            || raw.id?.slice(0, 24) || "untitled";
          const date = (raw.created_at || raw.createdAt || "").slice(0, 16);
          const msgCount = raw.message_count ?? raw.messageCount ?? 0;
          items.push({ id: `session:${raw.id}`, label: title, detail: `${msgCount} msgs  ${date}`, type: "session" });
        }
        setPickerItems(items);
        return;
      }

      // Regular slash commands
      const adapter = inkAdapter();
      const ctx = cmdCtx();
      const parts = trimmed.split(/\s+/);
      await processCommandAsync(trimmed, ctx, adapter);
      const resolved = (await import("@skeleton/core")).resolveSlashCommand(parts[0]);
      if (resolved?.name === "quit" || resolved?.name === "exit") exit();
      return;
    }

    // Normal message
    isProcessing.current = true;
    addLine("");
    addLine(chalk.bold("> ") + trimmed);
    setInput("");
    setStreaming(true);
    setThinking(true);
    setStreamText("");

    agent.onToolCall = () => {};
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

      // Commit final output
      const rendered = renderMarkdown(accumulated);
      const indented = rendered.split("\n").map(l => "    " + l).join("\n");
      addLines([chalk.dim("  ⎿") + indented, ""]);
    } catch (err) {
      addLine(chalk.dim("  ⎿ ") + chalk.red(`✗ ${(err as Error).message}`));
    } finally {
      setStreaming(false);
      setStreamText("");
      setThinking(false);
      isProcessing.current = false;
      setCtxProgress(agent.getContextProgress());
    }
  }, [agent, addLine, addLines, cmdCtx, inkAdapter, buildToolCompleteHandler, exit, sessionDb]);

  // Unified slash entries: built-in commands + user-invocable skills (Claude Code pattern).
  // Skills are treated as Command-shaped entries so `/` autocomplete shows them alongside
  // /new, /model, etc. Dispatch still goes through processCommandAsync which detects
  // skill names before looking up the command registry.
  const slashEntries = useMemo(() => {
    const skillReg = agent.getSkillRegistry();
    const skillEntries = skillReg
      ? skillReg.list()
          .filter((s: any) => s.userInvocable)
          .map((s: any) => ({
            name: s.name,
            description: s.description || "Skill",
            category: "Skill" as any,
          }))
      : [];
    return [...COMMAND_REGISTRY, ...skillEntries];
  }, [agent, lines.length]);

  // Key input
  useInput((ch, key) => {
    if (pickerItems !== null || modelPickerItems !== null) return;

    // Allow typing during processing
    if (isProcessing.current) {
      if (key.backspace) setInput(prev => prev.slice(0, -1));
      else if (ch && !key.ctrl && !key.meta && !key.return) {
        setInput(prev => (prev + ch).slice(0, 500));
      }
      return;
    }

    if (key.return) {
      if (input.startsWith("/") && !input.includes(" ")) {
        const partial = input.slice(1).toLowerCase();
        const matches = partial
          ? slashEntries.filter(c => c.name.startsWith(partial))
          : slashEntries;
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
    } else if (key.tab && input.startsWith("/")) {
      const partial = input.slice(1).toLowerCase();
      const matches = partial
        ? slashEntries.filter(c => c.name.startsWith(partial))
        : slashEntries;
      if (matches.length > 0 && selectedCmd < matches.length) {
        setInput("/" + matches[selectedCmd].name);
        setSelectedCmd(0);
      }
    } else if (key.upArrow && input.startsWith("/") && !input.includes(" ")) {
      setSelectedCmd(prev => Math.max(0, prev - 1));
    } else if (key.downArrow && input.startsWith("/") && !input.includes(" ")) {
      const partial = input.slice(1).toLowerCase();
      const count = partial
        ? slashEntries.filter(c => c.name.startsWith(partial)).length
        : slashEntries.length;
      setSelectedCmd(prev => Math.min(count - 1, prev + 1));
    } else if (key.backspace) {
      setInput(prev => prev.slice(0, -1));
      setSelectedCmd(0);
    } else if (key.escape) {
      if (input) { setInput(""); setSelectedCmd(0); }
    } else if (ch && !key.ctrl && !key.meta) {
      setInput(prev => (prev + ch).slice(0, 500));
      setSelectedCmd(0);
    }
  });

  const [currentModel, setCurrentModel] = useState(model);
  const shortModel = currentModel.length > 30 ? currentModel.slice(0, 27) + "..." : currentModel;

  // Model picker overlay
  if (modelPickerItems !== null) {
    return (
      <Box flexDirection="column">
        <SessionPicker
          items={modelPickerItems}
          onSelect={(item) => {
            setModelPickerItems(null);
            const modelName = item.id.replace("model:", "");
            agent.switchModel(modelName);
            setCurrentModel(modelName);
            addLine(chalk.green(`  ✓ Model switched to: ${chalk.white(modelName)}`));
          }}
          onCancel={() => { setModelPickerItems(null); addLine(chalk.gray("  Cancelled.")); }}
        />
      </Box>
    );
  }

  // Session picker overlay
  if (pickerItems !== null) {
    return (
      <Box flexDirection="column" height="100%">
        <SessionPicker
          items={pickerItems}
          onSelect={(item) => {
            setPickerItems(null);
            if (item.type === "branch") {
              const ok = agent.resumeBranch(item.id.replace("branch:", ""));
              if (ok) addLine(chalk.green(`  ✓ Resumed branch "${item.label}"`));
              else addLine(chalk.red(`  ✗ Failed to resume "${item.label}"`));
            } else {
              const sid = item.id.replace("session:", "");
              const messages = sessionDb.getMessages(sid);
              if (messages.length > 0) {
                addLine(chalk.dim("  ┌─ Previous Conversation ─────────────"));
                for (const msg of messages.slice(-20)) {
                  if (msg.role === "user") addLine(chalk.bold("  │ > ") + (msg.content || "").replace(/\n/g, " ").slice(0, 100));
                  else if (msg.role === "assistant") addLine(chalk.dim("  │ ⎿ ") + (msg.content || "").replace(/\n/g, " ").slice(0, 100));
                }
                addLine(chalk.dim("  └─────────────────────────────────────"));
                agent.loadMessages(messages);
                addLine(chalk.green(`  ✓ Resumed "${item.label}" (${messages.length} msgs)`));
              }
            }
          }}
          onCancel={() => { setPickerItems(null); addLine(chalk.gray("  Cancelled.")); }}
        />
      </Box>
    );
  }

  // Command suggestions (scrolling window around selectedCmd)
  const showSuggestions = input.startsWith("/") && !isProcessing.current;
  const SUGGEST_WINDOW = 10;
  let suggestions: typeof slashEntries = [];
  let totalSuggestions = 0;
  let windowStart = 0;
  if (showSuggestions) {
    const partial = input.slice(1).toLowerCase();
    const allMatches = partial
      ? slashEntries.filter(c => c.name.startsWith(partial))
      : slashEntries;
    totalSuggestions = allMatches.length;
    // Scroll so the selected item stays visible inside the SUGGEST_WINDOW
    const safeSelected = Math.max(0, Math.min(selectedCmd, totalSuggestions - 1));
    windowStart = Math.max(0, Math.min(
      safeSelected - Math.floor(SUGGEST_WINDOW / 2),
      Math.max(0, totalSuggestions - SUGGEST_WINDOW),
    ));
    suggestions = allMatches.slice(windowStart, windowStart + SUGGEST_WINDOW);
  }
  const maxNameLen = suggestions.length > 0 ? Math.max(...suggestions.map(c => c.name.length)) : 0;

  return (
    <Box flexDirection="column">
      {/* Logo header */}
      <Text color="yellow" bold>{`  ██████╗  Skeleton v0.1.0`}</Text>
      <Text><Text color="yellow" bold>{`  ██╔══██╗ `}</Text><Text color="gray">{shortModel}</Text></Text>
      <Text><Text color="yellow" bold>{`  ██████╔╝ `}</Text><Text color="gray">{process.cwd()}</Text></Text>
      <Text color="yellow" bold>{`  ██╔══╝   `}</Text>
      <Text color="yellow" bold>{`  ██║      `}</Text>
      <Text><Text color="yellow" bold>{`  ╚═╝      `}</Text><Text color="gray">{`${toolCount} tools · ${mcpCount} MCP`}</Text></Text>
      <Text>{""}</Text>

      {/* Messages */}
      {lines.map(line => (
        <Text key={line.id} wrap="wrap">{line.text}</Text>
      ))}

      {/* Streaming preview */}
      {streamText && (
        <Box paddingLeft={4}>
          <Text wrap="wrap">{streamText}</Text>
        </Box>
      )}
      {thinking && !streamText && (
        <Text color="gray">{"    ⏳ thinking..."}</Text>
      )}

      {/* Command suggestions */}
      {showSuggestions && suggestions.length > 0 && (
        <Box flexDirection="column" paddingLeft={2}>
          {windowStart > 0 && (
            <Text color="gray">{`  ↑ ${windowStart} more above`}</Text>
          )}
          {suggestions.map((cmd, i) => {
            const absoluteIdx = windowStart + i;
            const isSelected = absoluteIdx === selectedCmd;
            return (
              <Text key={cmd.name}>
                <Text color={isSelected ? "cyan" : "gray"}>{isSelected ? "❯ " : "  "}</Text>
                <Text color={isSelected ? "white" : "gray"} bold={isSelected}>
                  {`/${cmd.name.padEnd(maxNameLen + 2)}`}
                </Text>
                <Text color="gray">{cmd.description}</Text>
              </Text>
            );
          })}
          {windowStart + suggestions.length < totalSuggestions && (
            <Text color="gray">{`  ↓ ${totalSuggestions - windowStart - suggestions.length} more below`}</Text>
          )}
        </Box>
      )}

      {/* Input */}
      <Box>
        <Text bold color="white">{"> "}</Text>
        <Text>{input}</Text>
        <Text color="gray">█</Text>
      </Box>

      {/* Status line */}
      <Box paddingLeft={2}>
        <Text color="gray">{shortModel} · {toolCount} tools</Text>
        {ctxProgress && (
          <Text color={contextBarColor(ctxProgress.percent)}>
            {` · ${formatTokenCount(ctxProgress.usedTokens)}/${formatTokenCount(ctxProgress.contextWindow)} (${ctxProgress.percent}%)`}
          </Text>
        )}
        {streaming && <Text color="yellow"> · ●</Text>}
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
    config: { llm: { protocol: string; model: string; baseUrl: string; apiKey: string } };
    onQuit: () => Promise<void>;
  },
): Promise<void> {
  return new Promise(() => {
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
