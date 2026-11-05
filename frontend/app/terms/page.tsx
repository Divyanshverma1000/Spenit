"use client";

import Link from "next/link";
import { LegalPage, Mail } from "@/components/LegalPage";
import { LEGAL } from "@/lib/legal";

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro={`These terms are the agreement between you and ${LEGAL.OPERATOR}, who runs Spenit. By signing in or using Spenit you agree to them. Please read them; they're short.`}
    >
      <section>
        <h2>1. What Spenit is, and isn&apos;t</h2>
        <ul>
          <li>Spenit is a <b>record-keeping tool</b>: it records shared expenses and payments and works out who owes whom.</li>
          <li>Spenit is <b>not a bank or payment service</b>. It never holds, sends or receives money. &quot;Pay&quot; buttons only open your own payment app (for example a UPI app); the payment happens there, between you and the other person.</li>
          <li>Balances in Spenit are only as accurate as what members enter. A balance is not a legal debt or an invoice.</li>
        </ul>
      </section>

      <section>
        <h2>2. Your account</h2>
        <ul>
          <li>You sign in with Google and must be 18 or over (or have a parent or guardian&apos;s permission).</li>
          <li>Keep your Google account secure; you&apos;re responsible for what happens under your account.</li>
          <li>You can delete your account at any time from Profile.</li>
        </ul>
      </section>

      <section>
        <h2>3. Groups and what you add</h2>
        <ul>
          <li>You&apos;re responsible for what you add: expenses, names, photos, notes. Add it honestly.</li>
          <li>When you add someone who hasn&apos;t joined, make sure they&apos;re happy to be added.</li>
          <li>When you join a group, pick only <b>your own</b> name. Picking someone else&apos;s on purpose is not allowed. Mistakes can be undone.</li>
          <li>Other members of a group can see and, if they added it or are the admin, change or delete group records. Every change is shown to the group in Activity.</li>
          <li>You keep ownership of what you add. You let us store and show it to your groups so Spenit can work.</li>
        </ul>
      </section>

      <section>
        <h2>4. AI features</h2>
        <p>
          Reading screenshots, scanning receipts and the assistant use AI, which <b>can make mistakes</b>: wrong prices, items or totals.
          Check amounts before you save, and check answers before you rely on them. See the <Link href="/privacy">Privacy Policy</Link> for what is sent to the AI.
        </p>
      </section>

      <section>
        <h2>5. Fair use</h2>
        <p>Don&apos;t use Spenit to break the law, harass people, add fake expenses to cheat others, try to get into other people&apos;s groups or accounts, overload or attack the service, or copy it. We may suspend accounts that do.</p>
      </section>

      <section>
        <h2>6. Price</h2>
        <p>Spenit is free while we test it with early users. If we introduce paid plans, we&apos;ll show the price and what it includes before you pay. Nothing will be charged without your clear agreement, and refund rules will be shown at the time.</p>
      </section>

      <section>
        <h2>7. The service</h2>
        <ul>
          <li>We work to keep Spenit available and your data safe, but it&apos;s provided <b>&quot;as is&quot;</b>: it may sometimes be unavailable, slow or have bugs.</li>
          <li>We may change, add or remove features. If we ever shut Spenit down, we&apos;ll give notice so you can download your data.</li>
        </ul>
      </section>

      <section>
        <h2>8. Liability</h2>
        <p>
          As far as the law allows, we aren&apos;t liable for losses from wrong entries, disagreements between group members, payments made
          outside Spenit, AI mistakes, or the service being unavailable. While Spenit is free, our total liability to you is limited to ₹1,000.
          Nothing here limits rights you have by law that can&apos;t be limited.
        </p>
      </section>

      <section>
        <h2>9. Ending</h2>
        <p>You can stop using Spenit and delete your account at any time. We may suspend or end an account that breaks these terms, after a warning where reasonable.</p>
      </section>

      <section>
        <h2>10. Law</h2>
        <p>These terms are governed by the laws of {LEGAL.COUNTRY}, and the courts of {LEGAL.COUNTRY} have jurisdiction. If you&apos;re a consumer elsewhere, you keep any protections your local law gives you.</p>
      </section>

      <section>
        <h2>11. Changes and contact</h2>
        <p>
          If we change these terms, we&apos;ll update the date and version above and tell you in the app before important changes apply.
          Questions or complaints: <Mail />.
        </p>
      </section>
    </LegalPage>
  );
}
