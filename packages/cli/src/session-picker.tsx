/**
 * SessionPicker — interactive session/branch selector for /resume.
 *
 * Renders a vertical list of resumable items (branches + recent sessions).
 * User navigates with ↑/↓, confirms with Enter, cancels with Esc.
 * Selected item triggers the onSelect callback with the branch name or
 * session ID.
 *
 * Inspired by Claude Code's LogSelector component.
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "@skeleton/ink";
import chalk from "chalk";

export interface PickerItem {
  id: string;
  label: string;
  detail: string;
  type: "branch" | "session";
}

interface SessionPickerProps {
  items: PickerItem[];
  onSelect: (item: PickerItem) => void;
  onCancel: () => void;
}

export function SessionPicker({ items, onSelect, onCancel }: SessionPickerProps) {
  const [selected, setSelected] = useState(0);
  const maxVisible = Math.min(items.length, 15);

  useInput((_ch, key) => {
    if (key.escape) {
      onCancel();
    } else if (key.return) {
      if (items[selected]) onSelect(items[selected]);
    } else if (key.upArrow) {
      setSelected(prev => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelected(prev => Math.min(items.length - 1, prev + 1));
    }
  });

  if (items.length === 0) {
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Text color="gray">No sessions or branches to resume.</Text>
        <Text color="gray">Create a branch with /branch {"<name>"} first.</Text>
      </Box>
    );
  }

  // Scrolling window
  const halfWindow = Math.floor(maxVisible / 2);
  let startIdx = Math.max(0, selected - halfWindow);
  const endIdx = Math.min(items.length, startIdx + maxVisible);
  if (endIdx - startIdx < maxVisible) {
    startIdx = Math.max(0, endIdx - maxVisible);
  }
  const visible = items.slice(startIdx, endIdx);

  const maxLabelLen = Math.max(...visible.map(i => i.label.length));

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>Resume a conversation</Text>
        <Text color="gray">{`  (↑↓ navigate, Enter select, Esc cancel)`}</Text>
      </Box>

      {visible.map((item, i) => {
        const realIdx = startIdx + i;
        const isSelected = realIdx === selected;
        const icon = item.type === "branch" ? "●" : "◆";
        const iconColor = item.type === "branch" ? "green" : "yellow";
        const padded = item.label.padEnd(maxLabelLen + 2);

        return (
          <Box key={item.id}>
            <Text color={isSelected ? "cyan" : undefined}>
              {isSelected ? "❯ " : "  "}
            </Text>
            <Text color={iconColor}>{icon} </Text>
            <Text color={isSelected ? "white" : undefined} bold={isSelected}>
              {padded}
            </Text>
            <Text color="gray">{item.detail}</Text>
          </Box>
        );
      })}

      {items.length > maxVisible && (
        <Box marginTop={1}>
          <Text color="gray">{`  ${items.length} items total (scroll to see more)`}</Text>
        </Box>
      )}
    </Box>
  );
}
