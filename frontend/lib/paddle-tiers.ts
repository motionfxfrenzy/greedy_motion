// The three plans on /plans. Edit copy and features here; prices come from Paddle by price id, never from this file.
export interface Tier {
  name: "Starter" | "Pro" | "Advanced";
  description: string;
  features: string[];
  priceId: { month: string; year: string };
  featured?: boolean;
}

export const TIERS: Tier[] = [
  {
    name: "Starter",
    description: "For trying Greedy Motion on a first film.",
    features: ["7-day free trial", "Cancel any time"],
    priceId: { month: "pri_01m63zmpr7kqkppxzzn6nqcz35", year: "pri_01m63zmq39sxsnvs6vegxsvtgt" }
  },
  {
    name: "Pro",
    description: "For regular publishing.",
    features: ["7-day free trial", "Cancel any time"],
    priceId: { month: "pri_01m63zmqym5vpg29s9yrcd0skf", year: "pri_01m63zmr9zt1pn2s35jma8k2be" },
    featured: true
  },
  {
    name: "Advanced",
    description: "For teams and heavy use.",
    features: ["7-day free trial", "Cancel any time"],
    priceId: { month: "pri_01m63zms36k3pk2cdt4g48b5v3", year: "pri_01m63zmsdefqa6kfb84je085eb" }
  }
];
