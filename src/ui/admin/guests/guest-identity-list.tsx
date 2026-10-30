export interface GuestIdentity {
  name: string;
  instagram: string;
  profileHref: string;
}

export function GuestIdentityList({ guests }: { guests: readonly GuestIdentity[] }) {
  return (
    <ul className="grid gap-2">
      {guests.map((guest, index) => (
        <li key={`${index}-${guest.instagram}`}>
          <span className="block break-words">{guest.name}</span>
          <a
            href={guest.profileHref}
            target="_blank"
            rel="noopener noreferrer"
            className="admin-muted block text-sm break-all transition-colors duration-200 focus-visible:text-primary [@media(hover:hover)_and_(pointer:fine)]:hover:text-primary"
          >
            @{guest.instagram}
          </a>
        </li>
      ))}
    </ul>
  );
}
