"use client";

import { createContext, useContext } from "react";
import { avatarSrc, colorFor, initials, type AvatarPerson } from "@/lib/avatar";

/**
 * How a person looks everywhere in the app: their group avatar, else their photo, else
 * two-letter initials on their own colour. People who haven't joined get a dashed ring.
 */
export default function MemberAvatar({
  person, size = 32, dim = false, className = "",
}: {
  person: AvatarPerson;
  size?: number;
  dim?: boolean;
  className?: string;
}) {
  const src = avatarSrc(person);
  return (
    <span
      title={person.name}
      className={`relative inline-flex rounded-full items-center justify-center overflow-hidden flex-shrink-0 font-bold select-none ${
        person.isPlaceholder ? "outline-2 outline-dashed outline-[var(--border-dark)] outline-offset-1" : ""
      } ${dim ? "opacity-40 grayscale" : ""} ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.38)),
        backgroundColor: src ? "var(--paper-dim)" : colorFor(person.id),
        color: "#fff",
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" draggable={false} />
      ) : (
        initials(person.name)
      )}
    </span>
  );
}

/** The people of the group on screen, so deep components can draw an avatar from just an id. */
const PeopleContext = createContext<Record<string, AvatarPerson>>({});

export function AvatarPeople({ people, children }: { people: AvatarPerson[]; children: React.ReactNode }) {
  const map: Record<string, AvatarPerson> = {};
  for (const p of people) map[p.id] = p;
  return <PeopleContext.Provider value={map}>{children}</PeopleContext.Provider>;
}

export const usePerson = (id: string | undefined): AvatarPerson | undefined => {
  const map = useContext(PeopleContext);
  return id ? map[id] : undefined;
};

/** For lists that only carry { userId, name } (expense payers/splits): looks the person up in <AvatarPeople>. */
export function AvatarById({ id, name, size = 32 }: { id: string; name: string; size?: number }) {
  const person = usePerson(id);
  return <MemberAvatar person={person ?? { id, name }} size={size} />;
}
