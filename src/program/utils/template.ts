/**
 * Template Engine
 *
 * Replaces ${VARIABLE} placeholders in prompt templates
 */

/**
 * Replace variables in a template string
 *
 * @param template Template string with ${VARIABLE} placeholders
 * @param variables Object with variable values
 * @returns Processed template with variables replaced
 *
 * @example
 * replaceVariables("Hello ${NAME}!", { NAME: "World" })
 * // Returns: "Hello World!"
 */
export function replaceVariables(
  template: string,
  variables: Record<string, string | number | boolean>
): string {
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `\${${key}}`;
    const stringValue = String(value);
    result = result.replaceAll(placeholder, stringValue);
  }

  return result;
}

/**
 * Extract all variable names from a template
 *
 * @param template Template string with ${VARIABLE} placeholders
 * @returns Array of variable names found in template
 *
 * @example
 * extractVariables("Hello ${NAME}, you are ${AGE} years old")
 * // Returns: ["NAME", "AGE"]
 */
export function extractVariables(template: string): string[] {
  const regex = /\$\{([^}]+)\}/g;
  const variables: string[] = [];
  let match;

  while ((match = regex.exec(template)) !== null) {
    variables.push(match[1]);
  }

  return variables;
}

/**
 * Validate that all required variables are provided
 *
 * @param template Template string
 * @param variables Variables object
 * @returns True if all variables are provided, false otherwise
 */
export function validateVariables(
  template: string,
  variables: Record<string, string | number | boolean>
): { valid: boolean; missing: string[] } {
  const required = extractVariables(template);
  const provided = Object.keys(variables);
  const missing = required.filter((v) => !provided.includes(v));

  return {
    valid: missing.length === 0,
    missing,
  };
}
