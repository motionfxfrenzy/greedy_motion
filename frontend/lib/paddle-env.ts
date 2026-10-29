// Paddle environment and client token come from env vars only. Unset or mismatched values throw, so a page can never
// quietly run against the wrong Paddle account. NEXT_PUBLIC_* values must be read as literal `process.env.X` so Next inlines them.
export type PaddleEnvironment = "sandbox" | "production";

export function paddleEnv(): { environment: PaddleEnvironment; token: string } {
  const environment = process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT;
  const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error('NEXT_PUBLIC_PADDLE_ENVIRONMENT must be "sandbox" or "production" (it is unset or invalid).');
  }
  if (!token) throw new Error("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN is not set.");
  const expected = environment === "production" ? "live_" : "test_";
  if (!token.startsWith(expected)) {
    throw new Error(`NEXT_PUBLIC_PADDLE_CLIENT_TOKEN must start with "${expected}" for the ${environment} environment.`);
  }
  return { environment, token };
}
