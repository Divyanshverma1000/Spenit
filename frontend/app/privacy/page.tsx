"use client";

import Link from "next/link";
import { LegalPage, Mail } from "@/components/LegalPage";
import { LEGAL } from "@/lib/legal";

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={`Spenit helps groups of people record shared expenses and work out who owes whom. This policy explains what we collect, why, who it goes to, and what you can do about it. Spenit is run by ${LEGAL.OPERATOR} ("we", "us").`}
    >
      <section>
        <h2>1. What we collect</h2>
        <ul>
          <li><b>Your account.</b> When you sign in with Google: your name, email address, profile picture and Google account ID. We never see your Google password.</li>
          <li><b>Things you add.</b> Groups, the expenses and payments in them, item lists of imported orders, notes, nicknames, avatars you pick, a profile photo if you upload one, your UPI ID if you add it, and your own AI key if you add one.</li>
          <li><b>Other people&apos;s names.</b> When you add someone who hasn&apos;t joined yet, we store the name you give them. Only add people who are happy to be in the group.</li>
          <li><b>Screenshots and receipt photos.</b> When you import orders or scan a receipt, the image is sent to our server and to our AI provider to read it. <b>We don&apos;t keep the image</b>; we keep only what you save (items, prices, who shares what).</li>
          <li><b>Questions you ask the assistant.</b> Sent with your group&apos;s data to our AI provider to answer. The chat history stays on your device for the session; we don&apos;t store it on our servers.</li>
          <li><b>Messages you send us.</b> When you report a problem or share an idea, we keep the message with the screen you were on, the app version and your device type, to fix things and reply.</li>
          <li><b>How you use Spenit.</b> The days you open it, when you were last active, and counts of what you use (bills added, screenshots read, questions asked). We look at this to see whether Spenit is useful and what to improve. It holds no bill contents, isn&apos;t shared with anyone and isn&apos;t used for ads.</li>
          <li><b>Notifications.</b> If you allow them, a push subscription for your device.</li>
          <li><b>Technical data.</b> IP address, device and browser type, and error logs, kept for a short time to run the service and keep it secure.</li>
        </ul>
      </section>

      <section>
        <h2>2. How we use it</h2>
        <ul>
          <li>To run Spenit: show your groups, calculate balances, send reminders and notifications.</li>
          <li>To read screenshots and receipts and to answer questions with AI, only when you ask.</li>
          <li>To keep accounts secure and to fix problems.</li>
        </ul>
        <p className="mt-2">We don&apos;t sell your data, we don&apos;t show ads, and we don&apos;t use your data to build advertising profiles.</p>
      </section>

      <section>
        <h2>3. Who can see what</h2>
        <ul>
          <li><b>People in your groups</b> see the group&apos;s expenses, payments, balances, item lists and the group&apos;s activity log, including what you add and change.</li>
          <li>An item that only one person had is <b>private</b>: other members see &quot;Private item&quot; and its price, not what it was, unless that person chooses to show it. The person who added the bill can see it.</li>
          <li>Your profile photo can be shown to people in your groups.</li>
        </ul>
      </section>

      <section>
        <h2>4. Services we use</h2>
        <p>These companies process data for us, only to provide Spenit:</p>
        <ul>
          <li><b>Google</b>: sign-in.</li>
          <li><b>Supabase</b>: database where your account and group data is stored.</li>
          <li><b>Cloudflare</b>: runs our server (API) and protects it.</li>
          <li><b>Vercel</b>: hosts the app you open in your browser.</li>
          <li><b>Groq</b>: AI that reads screenshots and receipts and answers questions. It gets the image or the group data needed for that one request.</li>
          <li><b>Your browser&apos;s push service</b> (Google, Apple or Mozilla): delivers notifications.</li>
        </ul>
        <p className="mt-2">These providers may process data outside {LEGAL.COUNTRY}. We only use providers that protect it under their own security and privacy terms.</p>
      </section>

      <section>
        <h2>5. On your device</h2>
        <p>The app stores your sign-in, a copy of your recent data (so it opens fast and works offline), unsent expenses, your theme and the assistant chat on your device. We don&apos;t use advertising or tracking cookies.</p>
      </section>

      <section>
        <h2>6. How long we keep it</h2>
        <ul>
          <li>Your account data: until you delete your account.</li>
          <li>Group records: as long as the group exists, because they are also the other members&apos; records.</li>
          <li>Technical logs: a short period (usually days, at most a few months).</li>
        </ul>
      </section>

      <section>
        <h2>7. Deleting your account</h2>
        <p>
          Go to <Link href="/profile">Profile</Link> → <b>Delete account</b>. We erase your name, email, Google link, photo, UPI ID, AI key, personal expenses
          and notification settings. In groups where you&apos;re settled up, you leave the group. In groups where money is still open, the
          bills stay so everyone else&apos;s balances still add up, but they show <b>&quot;Deleted user&quot;</b> instead of you.
        </p>
      </section>

      <section>
        <h2>8. Your rights</h2>
        <p>
          Under India&apos;s Digital Personal Data Protection Act, 2023 (and, if you&apos;re in the EU or UK, the GDPR) you can:
        </p>
        <ul>
          <li><b>See and download</b> your data: Profile → <b>Download my data</b>.</li>
          <li><b>Correct</b> it: edit your name, nickname, photo and details in the app, or ask us.</li>
          <li><b>Delete</b> it: Profile → <b>Delete account</b>.</li>
          <li><b>Withdraw consent</b>: stop using Spenit and delete your account; AI features run only when you use them.</li>
          <li><b>Complain</b>: write to our grievance officer (below). You can also complain to the Data Protection Board of India, or your local data protection authority.</li>
          <li><b>Nominate</b> someone to act for you if you can&apos;t: write to us.</li>
        </ul>
      </section>

      <section>
        <h2>9. Age</h2>
        <p>Spenit is for people aged 18 or over. If you&apos;re younger, use it only with a parent or guardian&apos;s permission. If you think a child has given us data without that, tell us and we&apos;ll delete it.</p>
      </section>

      <section>
        <h2>10. Security</h2>
        <p>Data travels encrypted (HTTPS). Access to group data is checked on our server for every request. If a breach affects your data, we&apos;ll tell you and the authorities as the law requires.</p>
      </section>

      <section>
        <h2>11. Changes</h2>
        <p>If we change this policy, we&apos;ll update the date and version above and tell you in the app before important changes take effect.</p>
      </section>

      <section>
        <h2>12. Contact and grievance officer</h2>
        <p>
          {LEGAL.GRIEVANCE_OFFICER}, grievance officer for Spenit: <Mail />. We reply within {LEGAL.REPLY_DAYS} days.
        </p>
        <p className="mt-2">See also our <Link href="/terms">Terms of Service</Link>.</p>
      </section>
    </LegalPage>
  );
}
