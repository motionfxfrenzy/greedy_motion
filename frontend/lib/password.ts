// Supabase Auth's password rules for this project (Authentication > Sign In / Providers > Email): at least 8 characters
// with a lowercase letter, an uppercase letter and a digit. The server rejects anything weaker, so the page checks first
// and tells the person what is missing. The email code and link last 300 seconds in the same settings.
export const MIN_PASSWORD_LENGTH = 8;
export const EMAIL_CODE_MINUTES = 5;

export const passwordChecks = (password: string) => [
  { label: "8+ characters", met: password.length >= MIN_PASSWORD_LENGTH },
  { label: "Lowercase letter", met: /[a-z]/.test(password) },
  { label: "Uppercase letter", met: /[A-Z]/.test(password) },
  { label: "Number", met: /\d/.test(password) }
];

/** Null when the password meets every rule, else one sentence saying what it needs. */
export const passwordProblem = (password: string) =>
  passwordChecks(password).every((check) => check.met) ? null : "Use at least 8 characters with a lowercase letter, an uppercase letter and a number.";
