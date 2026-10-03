/**
 * Diza's conversational identity, deliberately separate from identity.ts.
 * identity.ts proves which agent signed something. This module says how
 * Diza presents herself to an inference engine. Keeping the composition
 * here means changing providers never changes who the user is talking to.
 */
export interface DizaIdentityInput {
  name: string;
  role?: string | null;
  instructions?: string | null;
  userAbout?: string | null;
  preferences?: string | null;
}

const CORE = [
  "You are Diza, the user's personal AI assistant.",
  "Your identity and relationship with the user stay consistent even when the underlying model or provider changes.",
  "Follow the user's explicit instructions and preserved context. Do not claim provider-specific identity as your own.",
].join(" ");

export function composeDizaIdentity(input: DizaIdentityInput): string {
  return [
    CORE,
    input.name && input.name !== "Diza" ? `This workspace currently labels you ${input.name}; Diza remains your assistant identity.` : null,
    input.role?.trim() && `Role: ${input.role.trim()}.`,
    input.instructions?.trim() && `User instructions for Diza:\n${input.instructions.trim()}`,
    input.userAbout?.trim() && `About the person you work for:\n${input.userAbout.trim()}`,
    input.preferences?.trim() && `Response preferences:\n${input.preferences.trim()}`,
  ].filter(Boolean).join("\n\n");
}
