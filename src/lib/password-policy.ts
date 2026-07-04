const COMMON_PASSWORD_FRAGMENTS = [
  "password",
  "admin123",
  "qwerty",
  "123456",
  "letmein",
  "welcome",
] as const;

export interface PasswordPolicyValidation {
  valid: boolean;
  errors: string[];
}

function getMinLength(): number {
  const configured = Number.parseInt(process.env.AUTH_PASSWORD_MIN_LENGTH ?? "10", 10);

  if (!Number.isFinite(configured) || configured < 8) {
    return 10;
  }

  return configured;
}

export function validatePasswordPolicy(password: string, email?: string): PasswordPolicyValidation {
  const errors: string[] = [];
  const minLength = getMinLength();
  const loweredPassword = password.toLowerCase();

  if (password.length < minLength) {
    errors.push(`La password deve contenere almeno ${minLength} caratteri.`);
  }

  if (!/[A-Z]/.test(password)) {
    errors.push("La password deve contenere almeno una lettera maiuscola.");
  }

  if (!/[a-z]/.test(password)) {
    errors.push("La password deve contenere almeno una lettera minuscola.");
  }

  if (!/[0-9]/.test(password)) {
    errors.push("La password deve contenere almeno un numero.");
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push("La password deve contenere almeno un simbolo.");
  }

  if (email) {
    const loweredEmail = email.toLowerCase();
    if (loweredEmail.length > 2 && loweredPassword.includes(loweredEmail)) {
      errors.push("La password non deve contenere l email.");
    }

    const localPart = loweredEmail.split("@")[0];
    if (localPart && localPart.length > 2 && loweredPassword.includes(localPart)) {
      errors.push("La password non deve contenere parti identificative dell email.");
    }
  }

  if (COMMON_PASSWORD_FRAGMENTS.some((value) => loweredPassword.includes(value))) {
    errors.push("La password contiene una sequenza troppo comune.");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function getPasswordPolicyDescription(): string {
  const minLength = getMinLength();

  return [
    `almeno ${minLength} caratteri`,
    "almeno una lettera maiuscola",
    "almeno una lettera minuscola",
    "almeno un numero",
    "almeno un simbolo",
    "assenza di email o sequenze comuni",
  ].join(", ");
}

export function maskEmailForSecurityLog(email: string): string {
  const [localPart = "", domainPart = ""] = email.split("@");

  if (!localPart || !domainPart) {
    return "invalid-email";
  }

  const visible = localPart.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(localPart.length - 2, 1))}@${domainPart}`;
}
