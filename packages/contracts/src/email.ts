/**
 * Email address validation for signup and sign-in.
 *
 * Rules:
 * - Surround whitespace is trimmed before validation.
 * - Preserves standard address syntax (`local@domain.tld`, no internal whitespace, single `@`).
 * - Local part (before `@`) must not contain `+`.
 * - Local part (before `@`) may contain at most 2 dots (`.`); 3 or more dots are rejected.
 * - Domain dots (after `@`) do not count toward the local-part dot limit.
 *
 * Does not strip dots or rewrite aliases.
 */

export const MAX_EMAIL_LOCAL_DOTS = 2;

export type EmailValidationFailureCode = "syntax" | "plus_not_allowed" | "too_many_dots";

export type EmailValidationResult =
  | {
      ok: true;
      email: string;
      localPart: string;
      domain: string;
      localDotCount: number;
    }
  | {
      ok: false;
      code: EmailValidationFailureCode;
      message: string;
    };

export const EMAIL_VALIDATION_MESSAGES: Record<EmailValidationFailureCode, string> = {
  syntax: "Enter a valid email address.",
  plus_not_allowed: "Email addresses with '+' before '@' are not supported.",
  too_many_dots: "Email addresses with more than 2 dots before '@' are not supported."
};

const BASIC_EMAIL_SYNTAX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmailAddress(input: unknown): EmailValidationResult {
  if (typeof input !== "string") {
    return { ok: false, code: "syntax", message: EMAIL_VALIDATION_MESSAGES.syntax };
  }

  const email = input.trim();
  if (!BASIC_EMAIL_SYNTAX.test(email)) {
    return { ok: false, code: "syntax", message: EMAIL_VALIDATION_MESSAGES.syntax };
  }

  const atIndex = email.indexOf("@");
  if (atIndex <= 0 || atIndex !== email.lastIndexOf("@")) {
    return { ok: false, code: "syntax", message: EMAIL_VALIDATION_MESSAGES.syntax };
  }

  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  if (!localPart || !domain || !domain.includes(".")) {
    return { ok: false, code: "syntax", message: EMAIL_VALIDATION_MESSAGES.syntax };
  }

  if (localPart.includes("+")) {
    return { ok: false, code: "plus_not_allowed", message: EMAIL_VALIDATION_MESSAGES.plus_not_allowed };
  }

  let localDotCount = 0;
  for (let i = 0; i < localPart.length; i++) {
    if (localPart.charCodeAt(i) === 46) localDotCount++;
  }

  if (localDotCount > MAX_EMAIL_LOCAL_DOTS) {
    return { ok: false, code: "too_many_dots", message: EMAIL_VALIDATION_MESSAGES.too_many_dots };
  }

  return {
    ok: true,
    email,
    localPart,
    domain,
    localDotCount
  };
}

/** Null when the email passes syntax and local-part rules, else a clear user-facing message. */
export function emailProblem(input: unknown): string | null {
  const result = validateEmailAddress(input);
  return result.ok ? null : result.message;
}

/** True when the email passes syntax and local-part rules after surrounding-whitespace trim. */
export function isAllowedEmail(input: unknown): boolean {
  return validateEmailAddress(input).ok;
}
