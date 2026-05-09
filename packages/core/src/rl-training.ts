/**
 * RL Training utilities — trajectory collection, reward computation, batch sampling.
 * Tinker-Atopos style: tracks task completion, token efficiency, tool call counts.
 */

export interface Trajectory {
  sessionId: string;
  messages: Array<{
    role: "user" | "assistant" | "tool";
    content: string;
    toolCalls?: number;
  }>;
  totalInputTokens: number;
  totalOutputTokens: number;
  toolCallCount: number;
  taskCompleted: boolean;
  durationMs: number;
  timestamp: number;
}

export interface RewardConfig {
  /** Weight for task completion (default 0.5) */
  completionWeight: number;
  /** Weight for token efficiency (default 0.3) */
  efficiencyWeight: number;
  /** Weight for tool call penalty (default 0.2) */
  toolCallWeight: number;
  /** Maximum token budget before efficiency score drops to 0 (default 10000) */
  maxTokenBudget: number;
  /** Penalty per tool call beyond optimal (default 0.05) */
  toolCallPenalty: number;
  /** Optimal number of tool calls (default 3) */
  optimalToolCalls: number;
}

const DEFAULT_REWARD_CONFIG: RewardConfig = {
  completionWeight: 0.5,
  efficiencyWeight: 0.3,
  toolCallWeight: 0.2,
  maxTokenBudget: 10000,
  toolCallPenalty: 0.05,
  optimalToolCalls: 3,
};

export class RLTrainer {
  private trajectories: Trajectory[] = [];
  private rewardConfig: RewardConfig;

  constructor(config?: Partial<RewardConfig>) {
    this.rewardConfig = { ...DEFAULT_REWARD_CONFIG, ...config };
  }

  /** Add a trajectory for training */
  addTrajectory(session: Trajectory): void {
    this.trajectories.push(session);
  }

  /** Compute reward for a trajectory */
  computeReward(trajectory: Trajectory): number {
    const cfg = this.rewardConfig;

    // Completion score: 1 if done, 0 otherwise
    const completionScore = trajectory.taskCompleted ? 1 : 0;

    // Efficiency score: inverse of token usage relative to budget
    const totalTokens = trajectory.totalInputTokens + trajectory.totalOutputTokens;
    const efficiencyScore = totalTokens >= cfg.maxTokenBudget
      ? 0
      : 1 - totalTokens / cfg.maxTokenBudget;

    // Tool call score: penalty for exceeding optimal count
    const excessCalls = Math.max(0, trajectory.toolCallCount - cfg.optimalToolCalls);
    const toolCallScore = Math.max(0, 1 - excessCalls * cfg.toolCallPenalty);

    return (
      cfg.completionWeight * completionScore +
      cfg.efficiencyWeight * efficiencyScore +
      cfg.toolCallWeight * toolCallScore
    );
  }

  /** Sample a batch of trajectories for training */
  sampleBatch(size: number): Trajectory[] {
    if (this.trajectories.length === 0) return [];
    const actualSize = Math.min(size, this.trajectories.length);
    const shuffled = [...this.trajectories].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, actualSize);
  }

  /** Export all trajectories as JSONL string */
  exportDataset(): string {
    return this.trajectories
      .map(t => JSON.stringify({ ...t, reward: this.computeReward(t) }))
      .join("\n");
  }

  /** Get trajectory count */
  size(): number {
    return this.trajectories.length;
  }

  /** Clear all trajectories */
  clear(): void {
    this.trajectories = [];
  }
}
