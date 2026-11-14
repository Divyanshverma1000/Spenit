import { describe, expect, it } from "vitest";
import { answerWithItems } from "./chatItems";

describe("answerWithItems", () => {
  const rows = [
    { name: "Karkure Chilli Chatka Crisps", qty: null, price: 20, mine: 20 },
    { name: "Hocco Chillo Dark Chocolate Ice Cream Cone", qty: null, price: 50, mine: 50 },
    { name: "Munch King Size Wafer Bar", qty: 6, price: 60, mine: 30 },
  ];
  it("keeps the model's lead, drops its own list and total, and adds the exact ones", () => {
    const lead = "Here are the unhealthy treats you bought.\n- Ice cream cone (generic entry) ₹180\n- Buttermilk ₹50\nTotal unhealthy spend: ₹1,214.";
    const out = answerWithItems(lead, rows);
    expect(out.startsWith("Here are the unhealthy treats you bought.")).toBe(true);
    expect(out).not.toContain("generic entry");
    expect(out).not.toContain("1,214");
    expect(out).toContain("- Munch King Size Wafer Bar x6: ₹60 (you ₹30)");
    expect(out).toContain("**3 items, ₹130** · your part **₹100**");
  });
});
