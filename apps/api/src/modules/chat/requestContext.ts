// Request-context keys shared by the chat tools and workflows. Set server-side by the member
// middleware, never from a tool input.

/** The farm member behind the request. */
export const MEMBER_ID_KEY = "memberId";
/** That member's farm: every tool and workflow step works on this farm only. */
export const FARM_ID_KEY = "farmId";
