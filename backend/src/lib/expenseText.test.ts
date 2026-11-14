import { describe, expect, it } from "vitest";
import { aliasesOf, categoryFromText, membersNamedIn, payerFromText, sharersFromText } from "./expenseText";

const me = { id: "me", name: "Divyansh Verma", realName: "Divyansh Verma", username: "divyansh" };
const shan = { id: "s", name: "Shan", realName: "Suryansh Kumar", username: "suryansh_k" };
const ankit = { id: "a", name: "Ankit", realName: "Ankit", username: "ankit" };
const members = [me, shan, ankit];

describe("names", () => {
  it("knows a person by nickname, real name, first name and username", () => {
    expect(aliasesOf(shan)).toEqual(expect.arrayContaining(["shan", "suryansh kumar", "suryansh", "suryansh k"]));
    expect(membersNamedIn("Cab for 128 between me and suryansh", members, "me")).toEqual(["s"]);
    expect(membersNamedIn("cab with Shan", members, "me")).toEqual(["s"]);
  });
});

describe("who shares it", () => {
  it("between me and Suryansh → the two of us", () => {
    expect(sharersFromText("Cab for 128 between me and suryansh", members, "me")).toEqual(["me", "s"]);
  });
  it("leaves everyone / except to the model", () => {
    expect(sharersFromText("Pizza 1400 everyone except Ankit", members, "me")).toBeNull();
    expect(sharersFromText("Dinner 900 split equally", members, "me")).toBeNull();
  });
  it("only me", () => {
    expect(sharersFromText("Coffee 120 only me", members, "me")).toEqual(["me"]);
  });
});

describe("who paid", () => {
  it("reads 'Ankit paid' and 'I paid'", () => {
    expect(payerFromText("Dinner 900 Ankit paid", members, "me")).toBe("a");
    expect(payerFromText("I paid 500 for groceries", members, "me")).toBe("me");
    expect(payerFromText("Cab 128 between me and suryansh", members, "me")).toBeNull();
  });
});

describe("category", () => {
  it("a cab is Travel, dinner is Food, rent is Stay", () => {
    expect(categoryFromText("Cab for 128 between me and suryansh")).toBe("Travel");
    expect(categoryFromText("Dinner 900 Rahul paid")).toBe("Food");
    expect(categoryFromText("Rent 24000 split equally")).toBe("Stay");
    expect(categoryFromText("something 50")).toBeNull();
  });
});

describe("who shares it, with someone else paying", () => {
  it("'Ankit paid 500 for dinner with Shan' → Ankit and Shan, not me", () => {
    expect(sharersFromText("Ankit paid 500 for dinner with Shan", members, "me")?.sort()).toEqual(["a", "s"]);
  });
  it("'Ankit paid for dinner and drinks' says nothing about who shares", () => {
    expect(sharersFromText("Ankit paid 900 for dinner and drinks", members, "me")).toBeNull();
  });
});
