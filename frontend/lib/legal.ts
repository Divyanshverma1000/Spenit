/**
 * legal.ts — the facts the Privacy Policy and Terms depend on, in one place.
 * Change these here (not in the pages). Bump VERSION and EFFECTIVE when the meaning of
 * either document changes, and backend/src/lib/account.ts TERMS_VERSION with it.
 */
export const LEGAL = {
  VERSION: "2026-11-05",
  EFFECTIVE: "5 November 2026",
  /** who runs Spenit */
  OPERATOR: "Divyansh Verma",
  /** where privacy requests, complaints and the grievance officer are reached */
  CONTACT_EMAIL: "divyanshverma0428@gmail.com",
  GRIEVANCE_OFFICER: "Divyansh Verma",
  /** answer within this many days (DPDP Rules: grievances within 90 days at most) */
  REPLY_DAYS: 30,
  COUNTRY: "India",
};
