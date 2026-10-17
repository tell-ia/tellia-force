// Recipient phone presets for the VAPI persona hack: selecting a company saves
// the chosen number on that company's member, so the single VAPI number
// (+33 7 57 59 92 16) calls/texts the right person. Numbers are E.164, like member.phone.
export interface PhonePreset {
  label: string;
  number: string;
}

export const PHONE_PRESETS: PhonePreset[] = [
  { label: "Marceau", number: "+33695760226" },
  { label: "Axel", number: "+33637914888" },
  { label: "Imad", number: "+33609095969" },
  { label: "Vincent", number: "+33625841219" },
];
