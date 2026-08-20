export type DecisionState = "open" | "waiting" | "blocked";

export interface TodayDecision {
  state: DecisionState;
  voice: "Trainer" | "Nutritionist" | "Medication" | "System";
  question: string;
  context: string;
  choices: readonly string[];
}

export interface DataSourceStatus {
  name: string;
  detail: string;
  state: "planned" | "connected" | "attention";
}
