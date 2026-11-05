/**
 * testPlan.ts — the checklist friends and family run on their phones (/testing).
 * Each test says what to do and what should happen; platform notes cover the places
 * where Android and iPhone behave differently (install, notifications, UPI apps).
 * Keep ids stable: ticks are saved by id on each tester's phone.
 */

export type Platform = "android" | "ios";

export interface TestItem {
  id: string;
  title: string;
  steps: string;
  expect: string;
  /** shown only on this platform */
  only?: Platform;
  /** extra tips per platform */
  note?: Partial<Record<Platform, string>>;
  /** needs a second person (another phone or a friend) */
  withFriend?: boolean;
}

export interface TestSection { id: string; title: string; why: string; items: TestItem[] }

export const TEST_PLAN: TestSection[] = [
  {
    id: "start",
    title: "Getting started",
    why: "First impressions: signing in and putting Spenit on your home screen.",
    items: [
      {
        id: "signin",
        title: "Sign in with Google",
        steps: "Open spenit.vercel.app, tap Continue with Google, pick your account.",
        expect: "You land on Home. First time: three welcome cards, then Create your first group.",
      },
      {
        id: "install-android",
        only: "android",
        title: "Install the app (Android)",
        steps: "In Chrome: ⋮ menu → Install app (or Add to Home screen) → Install.",
        expect: "A Spenit icon on your home screen with the full round logo (not cut off). Opening it shows no browser bar.",
      },
      {
        id: "install-ios",
        only: "ios",
        title: "Install the app (iPhone)",
        steps: "Open the link in Safari (not Chrome) → Share button → Add to Home Screen → Add.",
        expect: "A Spenit icon on your home screen. Opening it shows no Safari bar. You may need to sign in once more inside the app.",
      },
      {
        id: "relaunch",
        title: "Close and reopen",
        steps: "Close the app fully (swipe it away), then open it from the home screen icon.",
        expect: "You're still signed in and Home shows your groups quickly, even on slow internet.",
      },
    ],
  },
  {
    id: "groups",
    title: "Groups & invites",
    why: "The core: getting the right people into a group.",
    items: [
      {
        id: "create-group",
        title: "Create a group",
        steps: "Groups → New group → give it a name.",
        expect: "The group opens. With only you in it, it says Invite your people first.",
      },
      {
        id: "add-name",
        title: "Add someone who hasn't joined",
        steps: "In the group: Add someone → type a friend's name → Add.",
        expect: "They appear in Members with Invite pending.",
      },
      {
        id: "personal-invite",
        withFriend: true,
        title: "Personal invite: Join as …",
        steps: "Tap the WhatsApp icon next to that person and send it to them. They open the link and sign in.",
        expect: "They see \"This invite is for <name>\" and one button: Join as <name>. After joining they're in the group under that name.",
      },
      {
        id: "public-invite",
        withFriend: true,
        title: "Group invite link",
        steps: "Tap Invite → share the link. Someone opens it while signed out.",
        expect: "They're asked to sign in, then come back to \"Who are you?\" with the names on the list.",
      },
      {
        id: "not-me",
        withFriend: true,
        title: "Picked the wrong name",
        steps: "Join with the group link and pick someone else's name on purpose. Then in the group tap Not me → pick the right name.",
        expect: "Balances move back to the right person. Activity shows the fix.",
      },
    ],
  },
  {
    id: "bills",
    title: "Bills",
    why: "Adding, editing and checking expenses.",
    items: [
      {
        id: "add-bill",
        title: "Add a bill by hand",
        steps: "In a group: Manual → amount, what it was for, who paid, who shares → Save.",
        expect: "It appears at the top of the list and balances update.",
      },
      {
        id: "import-one",
        title: "Import one order screenshot",
        steps: "Import orders → pick a screenshot of a Blinkit / Zepto / Instamart order → Sort it out → tap who had what → Check → Add.",
        expect: "Items and prices are read correctly (tell us if any are wrong). The bill shows a short line like \"Milk, bread +3\".",
      },
      {
        id: "import-many",
        title: "Import 5+ screenshots at once",
        steps: "Pick several screenshots, including two of the same long order.",
        expect: "Screenshots of the same order are joined into one. If it waits (\"busy, retrying\"), it finishes by itself.",
      },
      {
        id: "edit-bill",
        title: "Edit a bill",
        steps: "Tap a bill → Edit → change the amount or who shares an item → Save.",
        expect: "The new numbers show. Activity shows old → new.",
      },
      {
        id: "delete-restore",
        title: "Delete, then restore",
        steps: "Tap a bill → Delete. Then open Activity → Restore on that bill.",
        expect: "It comes back with the same shares.",
      },
      {
        id: "private-item",
        withFriend: true,
        title: "Private items",
        steps: "Import an order where one item is only yours. Ask a friend in the group to open the bill → See items → Full bill.",
        expect: "They see \"Private item\" with the price, not the name, until you tap Private → Shown to group.",
      },
    ],
  },
  {
    id: "settle",
    title: "Settling up & paying",
    why: "Money actually changing hands, and payment apps opening from Spenit.",
    items: [
      {
        id: "upi-id",
        title: "Add your UPI ID",
        steps: "Profile → UPI ID → type yours (like name@okaxis) → Save.",
        expect: "Saved. Friends who owe you can now tap Pay.",
      },
      {
        id: "pay-upi",
        withFriend: true,
        title: "Pay with a UPI app",
        steps: "If you owe someone who has a UPI ID saved: Settle Up → Pay → it should open your UPI app with their name and the amount filled in. You can cancel there without paying.",
        expect: "A UPI app opens (Google Pay, PhonePe, Paytm, BHIM…) with the amount ready.",
        note: {
          android: "Android asks which UPI app to use. Pick any. If nothing opens, tell us which apps you have.",
          ios: "iPhones only open UPI apps that support UPI links. If nothing opens or Safari says the address is invalid, report it with the names of the UPI apps you have installed.",
        },
      },
      {
        id: "confirm",
        withFriend: true,
        title: "Confirm a payment",
        steps: "Mark a payment as paid. The person you paid opens Settle Up and taps Confirm.",
        expect: "Both balances update only after Confirm. Before that it shows as waiting.",
      },
      {
        id: "leave",
        title: "Leave a group",
        steps: "In a group where you still owe or are owed: Members → Leave group.",
        expect: "It explains you need to settle up first (no leaving with money open). In a settled group, leaving works.",
      },
      {
        id: "whatsapp",
        title: "Share on WhatsApp",
        steps: "In a group: Share. Or the WhatsApp icon next to someone who owes.",
        expect: "WhatsApp opens with a ready message and a link that works when opened.",
      },
    ],
  },
  {
    id: "spending",
    title: "Your spending & the assistant",
    why: "Personal tracking and asking questions.",
    items: [
      {
        id: "quick-add",
        title: "Quick add",
        steps: "Personal → type \"chai 20\" → Add. Then \"auto 60 yesterday\".",
        expect: "Both appear under the right day and category. Undo works.",
      },
      {
        id: "group-share",
        title: "Your group shares show up",
        steps: "Open Personal after adding a group bill.",
        expect: "Your share of that bill is listed with the group's name, and counted in the month total.",
      },
      {
        id: "budget",
        title: "Monthly budget",
        steps: "Tap Set a monthly budget → enter an amount.",
        expect: "A bar shows how much is left and roughly how much per day.",
      },
      {
        id: "ask",
        title: "Ask the assistant",
        steps: "In a group: Ask Spenit → \"What's pending?\". In Personal: Ask → \"How much on milk?\"",
        expect: "Sensible answers with real amounts from your bills (tell us if anything is wrong).",
      },
    ],
  },
  {
    id: "notify",
    title: "Notifications",
    why: "Knowing when someone adds a bill or pays you.",
    items: [
      {
        id: "allow",
        title: "Turn on notifications",
        steps: "When Spenit asks, tap Allow (or Profile → Notifications).",
        expect: "No error. Profile shows notifications are on.",
        note: {
          android: "Works in Chrome and in the installed app.",
          ios: "Only works in the installed app (Add to Home Screen first) on iOS 16.4 or newer. Allow it from inside the installed app, not Safari.",
        },
      },
      {
        id: "receive",
        withFriend: true,
        title: "Get a notification",
        steps: "Ask a friend in your group to add a bill, while Spenit is closed on your phone.",
        expect: "A notification arrives within about a minute. Tapping it opens that group.",
        note: {
          android: "If nothing arrives, check Settings → Apps → Chrome (or Spenit) → Notifications, and battery saver.",
          ios: "If nothing arrives, check Settings → Notifications → Spenit.",
        },
      },
    ],
  },
  {
    id: "app",
    title: "App behaviour",
    why: "Small things that make it feel solid.",
    items: [
      {
        id: "offline",
        title: "Offline",
        steps: "Turn on airplane mode → add a bill → turn internet back on.",
        expect: "It says it's saved on the phone, then syncs by itself once online. No duplicate.",
      },
      {
        id: "dark",
        title: "Dark and light mode",
        steps: "Profile → Appearance → switch theme. Look at Home, a group, Personal.",
        expect: "Everything readable, nothing white-on-white or black-on-black.",
      },
      {
        id: "big-text",
        title: "Large text",
        steps: "Turn up the font size in your phone's settings, then open Spenit.",
        expect: "No text cut off or hidden behind the bottom bar.",
      },
      {
        id: "report",
        title: "Report a problem",
        steps: "Profile → Report a problem or share an idea → send a test message.",
        expect: "It says Thank you.",
      },
    ],
  },
];

export const ALL_ITEMS = TEST_PLAN.flatMap((s) => s.items.map((i) => ({ ...i, section: s.title })));

export function detectPlatform(ua: string): Platform | null {
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && /mobile/i.test(ua))) return "ios";
  if (/android/i.test(ua)) return "android";
  return null;
}

export const itemsFor = (platform: Platform | null) =>
  TEST_PLAN.map((s) => ({ ...s, items: s.items.filter((i) => !i.only || !platform || i.only === platform) }));
