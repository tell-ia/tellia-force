import { BriefSmsSchema, MemberPhoneSchema, SendBriefSmsBodySchema, SetMemberPhoneBodySchema, type BriefSms, type MemberPhone } from "@tellia/shared";
import { http } from "./core";

// VAPI persona hack: save the caller's phone on the selected company's member.
// LIVE: POST /members/:id/phone. Best-effort — callers ignore failures.
export async function setMemberPhone(memberId: number, phone: string): Promise<MemberPhone> {
  const body = SetMemberPhoneBodySchema.parse({ phone });
  return http.post(`/members/${memberId}/phone`, body, MemberPhoneSchema);
}

// LIVE: POST /notify/brief-sms — today's brief (the Today screen's advice for the selected farm)
// sent by SMS from the farm number through VAPI. The farmer can reply to Jean by SMS.
export async function sendBriefSms(phone: string): Promise<BriefSms> {
  return http.post("/notify/brief-sms", SendBriefSmsBodySchema.parse({ phone }), BriefSmsSchema);
}
