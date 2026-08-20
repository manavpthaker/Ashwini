export type AdherenceStatus = "recorded" | "not-recorded";

export interface MealRecord {
  id: string;
  date: string;
  note: string;
  source: "manual";
}

export interface AppState {
  version: 1;
  medicationByDate: Record<string, AdherenceStatus>;
  dietAnchor: string;
  dietAnchorByDate: Record<string, boolean>;
  meals: MealRecord[];
  trainingRestartDate: string;
  trainingNote: string;
  trainingPlan: string[];
  trainingSessionsByDate: Record<string, string>;
}

export const initialAppState: AppState = {
  version: 1,
  medicationByDate: {},
  dietAnchor: "",
  dietAnchorByDate: {},
  meals: [],
  trainingRestartDate: "",
  trainingNote: "",
  trainingPlan: [],
  trainingSessionsByDate: {},
};

export function localDate() {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function displayDate(date: string) {
  if (!date) return "Not set";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${date}T12:00:00`));
}

export function isAppState(value: unknown): value is AppState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AppState>;
  return candidate.version === 1 && typeof candidate.medicationByDate === "object" && typeof candidate.dietAnchor === "string" && typeof candidate.dietAnchorByDate === "object" && Array.isArray(candidate.meals) && typeof candidate.trainingRestartDate === "string" && typeof candidate.trainingNote === "string" && Array.isArray(candidate.trainingPlan) && typeof candidate.trainingSessionsByDate === "object";
}
