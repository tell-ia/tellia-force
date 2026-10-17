// Recipient phone presets for the VAPI persona hack: selecting a company saves
// the chosen number on that company's member, so the single VAPI number
// (+33 7 57 59 92 16) calls/texts the right person.
//
// TODO: replace the placeholders with the team's real E.164 numbers.
export interface PhonePreset {
  label: string;
  number: string;
}

export const PHONE_PRESETS: PhonePreset[] = [
  { label: "Marceau", number: "+33600000001" },
  { label: "Axel", number: "+33600000002" },
  { label: "Imad", number: "+33600000003" },
  { label: "Vincent", number: "+33600000004" },
];
