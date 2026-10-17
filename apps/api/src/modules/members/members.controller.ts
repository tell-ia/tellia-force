import { Hono } from "hono";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { MemberPhoneSchema, SetMemberPhoneBodySchema } from "@tellia/shared/app";
import { validate } from "../../core/validate";
import { db } from "../../supabase";

// Vincent's VAPI persona hack: only one VAPI number, so when the app selects a
// company it also saves the caller's phone on that company's member. A call/SMS
// on the single number then resolves to the right person + farm. Mount at `/members`.

const IdParam = z.object({ id: z.coerce.number().int() });

export const members = new Hono();

members.post(
  "/:id/phone",
  validate("param", IdParam),
  validate("json", SetMemberPhoneBodySchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const { phone } = c.req.valid("json");
    const { data, error } = await db
      .from("member")
      .update({ phone })
      .eq("id", id)
      .select("id, phone")
      .maybeSingle();
    if (error) throw new HTTPException(500, { message: error.message });
    if (!data) throw new HTTPException(404, { message: `member ${id} not found` });
    return c.json({ data: MemberPhoneSchema.parse(data) });
  },
);
