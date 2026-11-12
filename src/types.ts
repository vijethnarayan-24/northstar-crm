export type View = "dashboard" | "leads" | "pipeline" | "tasks" | "calendar" | "activity" | "reports" | "settings" | "detail";
export type Tone = "violet" | "green" | "amber" | "red" | "blue" | "orange" | "gray";

export interface Lead {
  name: string;
  company: string;
  source: string;
  type: string;
  temp: string;
  stage: string;
  value: string;
  valueNum: number;
  owner: string;
  ownerName: string;
  activity: string;
  followup: string;
  age: number;
}
