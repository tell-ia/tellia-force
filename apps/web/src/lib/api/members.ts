import { MemberPhoneSchema, SetMemberPhoneBodySchema, type MemberPhone } from "@tellia/shared";
import { http } from "./core";

// VAPI persona hack: save the caller's phone on the selected company's member.
// LIVE: POST /members/:id/phone. Best-effort — callers ignore failures.
export async function setMemberPhone(memberId: number, phone: string): Promise<MemberPhone> {
  const body = SetMemberPhoneBodySchema.parse({ phone });
  return http.post(`/members/${memberId}/phone`, body, MemberPhoneSchema);
}
