export const CODES = [
  "E101", "E102", "E103", "E104", "E105", "E106", "E107",
  "E201", "E203", "E204",
  "E301", "E302", "E303", "E304",
  "E401", "E402", "E403",
  "W101", "W102", "W103",
] as const;
export type Code = (typeof CODES)[number];
