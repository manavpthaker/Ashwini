export type MuscleGroupId = "chest" | "back" | "shoulders" | "arms" | "legs" | "core";

export interface MuscleGroup {
  id: MuscleGroupId;
  name: string;
  region: string;
  summary: string;
  movementPatterns: readonly string[];
}

export interface MovementReference {
  name: string;
  pattern: string;
  primary: readonly MuscleGroupId[];
  supporting: readonly MuscleGroupId[];
  equipment: string;
  cue: string;
}

export const muscleGroups: readonly MuscleGroup[] = [
  { id: "chest", name: "Chest", region: "Front torso", summary: "Often involved in horizontal and angled pressing patterns.", movementPatterns: ["Push"] },
  { id: "back", name: "Back", region: "Posterior torso", summary: "Often involved in pulling, bracing, and shoulder-blade control.", movementPatterns: ["Pull", "Hinge"] },
  { id: "shoulders", name: "Shoulders", region: "Upper torso", summary: "Often involved in pressing, pulling, and controlled overhead movement.", movementPatterns: ["Push", "Pull"] },
  { id: "arms", name: "Arms", region: "Upper limb", summary: "Often support pulling and pressing through elbow movement and grip.", movementPatterns: ["Push", "Pull", "Carry"] },
  { id: "legs", name: "Legs", region: "Lower body", summary: "Often involved in squatting, hinging, stepping, and locomotion.", movementPatterns: ["Squat", "Hinge", "Locomotion"] },
  { id: "core", name: "Core", region: "Trunk", summary: "Often supports bracing, force transfer, and controlled rotation.", movementPatterns: ["Carry", "Rotation", "Hinge"] },
];

export const movementReferences: readonly MovementReference[] = [
  {
    name: "Goblet squat",
    pattern: "Squat",
    primary: ["legs"],
    supporting: ["core", "back"],
    equipment: "A dumbbell or kettlebell",
    cue: "Keep the load close and use a comfortable depth you can control.",
  },
  {
    name: "Incline push-up",
    pattern: "Push",
    primary: ["chest", "shoulders"],
    supporting: ["arms", "core"],
    equipment: "A stable elevated surface",
    cue: "Choose an incline that lets the torso move as one controlled unit.",
  },
  {
    name: "One-arm row",
    pattern: "Pull",
    primary: ["back"],
    supporting: ["arms", "shoulders", "core"],
    equipment: "A dumbbell and stable support",
    cue: "Use a controlled pull and avoid turning the torso into the movement.",
  },
  {
    name: "Loaded carry",
    pattern: "Carry",
    primary: ["core", "legs"],
    supporting: ["arms", "shoulders", "back"],
    equipment: "One or two manageable weights",
    cue: "Walk slowly enough to keep posture and breathing steady.",
  },
];

export const referenceProvenance = {
  version: "starter-0.1",
  status: "Editorial scaffold — source review required",
  boundary: "General educational context only. It is not a personal plan, diagnosis, form assessment, or medical clearance.",
} as const;
