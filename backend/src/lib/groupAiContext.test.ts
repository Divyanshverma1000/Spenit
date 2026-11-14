import { describe, expect, it } from "vitest";
import { buildGroupContext, itemKind } from "./groupAiContext";

const members = [
  { id: "d", name: "Divyansh" },
  { id: "s", name: "Suryansh", isPlaceholder: true },
  { id: "a", name: "Ankit" },
];
const order = {
  id: "e1",
  description: "Blinkit order",
  amount: "300.00",
  category: "Shopping",
  createdAt: "2026-11-05T09:00:00Z",
  createdBy: { id: "d", name: "Divyansh" },
  payers: [{ userId: "d", name: "Divyansh", amountPaid: "300.00" }],
  splits: [
    { userId: "d", name: "Divyansh", shareAmount: "100.00" },
    { userId: "s", name: "Suryansh", shareAmount: "150.00" },
    { userId: "a", name: "Ankit", shareAmount: "50.00" },
  ],
  receiptData: {
    items: [
      { name: "Amul Taaza Toned Milk 1 L", short: "milk", qty: 2, lineTotal: 120, sharedBy: ["d", "s", "a"] },
      { name: "Harvest Gold Bread", lineTotal: 30, sharedBy: ["d", "s", "a"] },
      { name: null, lineTotal: 150, sharedBy: ["s"], masked: true },
    ],
    fees: [{ label: "Delivery", amount: 0 }],
  },
};

describe("buildGroupContext", () => {
  const ctx = buildGroupContext({
    groupName: "KPA6",
    viewerId: "d",
    members,
    expenses: [order],
    settlements: [
      { amount: "50", status: "pending", createdAt: "2026-11-05T10:00:00Z", fromUser: { id: "a", name: "Ankit" }, toUser: { id: "d", name: "Divyansh" } },
    ],
    balance: {
      memberBalances: [
        { userId: "d", name: "Divyansh", signedAmount: "200.00" },
        { userId: "s", name: "Suryansh", signedAmount: "-150.00" },
        { userId: "a", name: "Ankit", signedAmount: "-50.00" },
      ],
      simplifiedTransfers: [
        { from: "s", to: "d", amount: "150.00", fromName: "Suryansh", toName: "Divyansh" },
        { from: "a", to: "d", amount: "50.00", fromName: "Ankit", toName: "Divyansh" },
      ],
    },
    today: new Date("2026-11-05T12:00:00Z"),
  });

  it("says who owes what and what is still due", () => {
    expect(ctx.text).toContain("Divyansh (you): should get back ₹200.00");
    expect(ctx.text).toContain("Suryansh: owes ₹150.00");
    expect(ctx.text).toContain("Suryansh pays Divyansh (you) ₹150.00");
  });
  it("explains pending payments", () => {
    expect(ctx.text).toContain("Ankit paid Divyansh (you) ₹50.00 · waiting for Divyansh (you) to confirm, NOT counted");
  });
  it("totals items by kind with my part", () => {
    expect(ctx.text).toContain("- milk: ₹120.00 · you ₹40.00 · 1x");
    expect(ctx.text).toContain("- gold bread: ₹30.00 · you ₹10.00 · 1x");
    expect(ctx.text).toContain("private items (only the person who had them can see what they were): ₹150.00 in 1 rows");
  });
  it("lists each bill with items, never naming private ones", () => {
    expect(ctx.text).toContain('[E1] 2026-11-05 "Blinkit order" ₹300.00');
    expect(ctx.text).toContain("private item ₹150.00 [Suryansh]");
    expect(ctx.refs).toEqual({ E1: "e1" });
  });
  it("keeps totals for bills cut from the list", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ ...order, id: `x${i}` }));
    const big = buildGroupContext({ groupName: "G", viewerId: "d", members, expenses: many, settlements: [], balance: null, budget: 3000 });
    expect(big.text).toContain("200 expenses, ₹60000.00 in all");
    expect(big.text).toMatch(/and \d+ older expenses not listed/);
    expect(big.text.length).toBeLessThan(12000);
  });
});

describe("itemKind", () => {
  it("prefers the model's short name", () => {
    expect(itemKind({ name: "Amul Milk", short: "Milk " })).toBe("milk");
    expect(itemKind({ name: "Lay's Magic Masala Potato Chips (52 g)" })).toBe("potato chips");
  });
});

describe("why shares differ", () => {
  it("splits each share into whole group, some and own items, never by who paid", () => {
    const members = [{ id: "a", name: "Divyansh" }, { id: "b", name: "Suryansh" }, { id: "c", name: "Ankit" }];
    const order = {
      id: "e1", description: "Instamart order", amount: 330, createdAt: "2026-11-10T10:00:00Z",
      payers: [{ userId: "a", name: "Divyansh", amountPaid: 330 }],
      splits: [{ userId: "a", name: "Divyansh", shareAmount: 230 }, { userId: "b", name: "Suryansh", shareAmount: 50 }, { userId: "c", name: "Ankit", shareAmount: 50 }],
      receiptData: { items: [
        { name: "Dove Shampoo", short: "shampoo", lineTotal: 200, sharedBy: ["a"] },
        { name: "Bread", short: "bread", lineTotal: 100, sharedBy: ["a", "b", "c"] },
      ] },
    };
    const { text } = buildGroupContext({ groupName: "Flat", viewerId: "a", members, expenses: [order], settlements: [], balance: null });
    expect(text).toContain("WHY SHARES DIFFER");
    expect(text).toContain("Who PAID never changes anyone's share");
    // 330 paid for 300 of items: fees follow the items (x1.1)
    expect(text).toMatch(/Divyansh \(you\): share ₹256\.67 = whole group ₹36\.67 \+ shared with some ₹0\.00 \+ own items ₹220\.00 \(biggest own: shampoo ₹220\.00\)/);
    expect(text).toMatch(/Suryansh: share ₹36\.67 = whole group ₹36\.67/);
  });
});

import { searchTerms } from "./groupAiContext";

describe("items matching the question", () => {
  const members = [{ id: "a", name: "Divyansh" }, { id: "b", name: "Suryansh" }];
  const bill = (id: string, items: { name: string; lineTotal: number; sharedBy?: string[] }[]) => ({
    id, description: "Instamart order", amount: items.reduce((x, i) => x + i.lineTotal, 0), createdAt: "2026-11-10T10:00:00Z",
    payers: [{ userId: "a", name: "Divyansh", amountPaid: 1 }], splits: [{ userId: "a", name: "Divyansh", shareAmount: 1 }],
    receiptData: { items: items.map((i) => ({ ...i, sharedBy: i.sharedBy ?? ["a"] })) },
  });
  const expenses = [
    bill("x1", [{ name: "Crystal Microfiber Cloth Roll", lineTotal: 249 }, { name: "Karkure Chilli Chatka Crisps", lineTotal: 20 },
      { name: "Mother Dairy Probiotic Tadka Salted Buttermilk", lineTotal: 20 }, { name: "Hocco Chillo Dark Chocolate Ice Cream Cone", lineTotal: 50 }]),
    bill("x2", [{ name: "Kwalitty Wall's Cornetto Double Chocolate Frozen Dessert Cone", lineTotal: 40 },
      { name: "Kwalitty Wall's Cornetto Butterscotch Frozen Dessert Cone", lineTotal: 40 }, { name: "File 6 - Poster", lineTotal: 3 }]),
  ];

  it("turns everyday words into what bills say", () => {
    const t = searchTerms("how much on ice creams, chips and snacks?");
    expect(t).toEqual(expect.arrayContaining(["cornetto", "frozen dessert", "kurkure", "crisps"]));
  });

  it("lists every matching item from every bill, with exact totals", () => {
    const { text, refs } = buildGroupContext({ groupName: "Flat", viewerId: "a", members, expenses, settlements: [], balance: null, budget: 50, focus: "how much on ice creams and chips" });
    const block = text.slice(text.indexOf("ITEMS MATCHING"), text.indexOf("BALANCES NOW"));
    expect(block).toContain("Hocco Chillo Dark Chocolate Ice Cream Cone ₹50.00");
    expect(block).toContain("Cornetto Butterscotch");
    expect(block).toContain("Karkure Chilli Chatka Crisps ₹20.00");
    expect(block).not.toContain("Buttermilk");
    expect(block).not.toContain("Poster");
    expect(block).toContain("MATCHING TOTAL: 4 items, ₹150.00 in all, your part ₹150.00");
    expect(Object.values(refs)).toEqual(expect.arrayContaining(["x1", "x2"]));
  });

  it("says so when nothing matches", () => {
    const { text } = buildGroupContext({ groupName: "Flat", viewerId: "a", members, expenses, settlements: [], balance: null, focus: "how much on pizza" });
    expect(text).toContain("No matching items on any bill.");
  });
});

describe("unhealthy / junk questions", () => {
  it("cover snacks, chips, ice cream, chocolate and cold drinks", () => {
    const t = searchTerms("List all the unhealthy items I have been eating, snacks like chips kurkure tedhe medhe icecream chocolates and cold drinks");
    expect(t).toEqual(expect.arrayContaining(["kurkure", "tedhe", "medhe", "cornetto", "munch", "coke", "instant noodles", "nachos"]));
  });
});

describe("unhealthy leaves out staples and healthy items", () => {
  it("matches junk, not buttermilk, ketchup, peanut butter, oats or masala cubes", () => {
    const members = [{ id: "a", name: "Divyansh" }];
    const names = [
      "Karkure Chilli Chatka Crisps", "Mother Dairy Probiotic Tadka Salted Buttermilk", "Kissan Sweet & Spicy Chilli Ketchup",
      "Maggi Magic Cubes-Vegetarian Masala", "Pintola High Protein Dark Chocolate Crunchy Peanut Butter", "Only Earth Protein Oats Chocolate High Protein Instant",
      "Bournvita Chocolate Nutrition Drink Pouch", "NOICE Fresh Malai Lassi", "Diet Coke Can - Cola Sparkling Soft Drink",
      "MAGGI Double Masala Noodles", "Munch King Size Chocolate Coated Wafer Bar", "Kwalitty Wall's Cornetto Butterscotch Frozen Dessert Cone",
    ];
    const e = { id: "x", description: "Instamart", amount: 100, createdAt: "2026-11-10T10:00:00Z", payers: [], splits: [],
      receiptData: { items: names.map((name) => ({ name, lineTotal: 10, sharedBy: ["a"] })) } };
    const { items } = buildGroupContext({ groupName: "F", viewerId: "a", members, expenses: [e], settlements: [], balance: null, focus: "How much on unhealthy items" });
    const got = Object.values(items).map((r) => r.name);
    expect(got).toEqual(["Karkure Chilli Chatka Crisps", "Diet Coke Can - Cola Sparkling Soft Drink", "MAGGI Double Masala Noodles",
      "Munch King Size Chocolate Coated Wafer Bar", "Kwalitty Wall's Cornetto Butterscotch Frozen Dessert Cone"]);
  });
  it("still finds buttermilk when you ask for it", () => {
    const members = [{ id: "a", name: "Divyansh" }];
    const e = { id: "x", description: "Instamart", amount: 10, createdAt: "2026-11-10T10:00:00Z", payers: [], splits: [],
      receiptData: { items: [{ name: "Mother Dairy Probiotic Tadka Salted Buttermilk", lineTotal: 10, sharedBy: ["a"] }] } };
    const { items } = buildGroupContext({ groupName: "F", viewerId: "a", members, expenses: [e], settlements: [], balance: null, focus: "how much on buttermilk" });
    expect(Object.keys(items)).toHaveLength(1);
  });
});
