import { alumniAt, getCurrentMember, listCompanies, referralAvailabilityFor } from '../data/store.ts';
import { availabilityMessage } from './RequestComposer.tsx';
import type { ReferralAsk } from './RequestComposer.tsx';
import { Avatar, Button, Card, Chip, EmptyState } from './primitives.tsx';

export interface CompanyPageProps {
  companyId: string;
  onRequestReferral: (req: ReferralAsk) => void;
  /** Optional: lets a caller (App's directory flow) offer a way back. */
  onBack?: () => void;
  now?: number;
}

/**
 * The company page (§7.1 Must): alumni count at the company, and which of
 * them are currently open to referring, each with a *Request a referral*
 * button — enabled only when `referralAvailabilityFor` says the REFERRER is
 * actually taking asks right now.
 *
 * `alumniAt` is already viewer-scoped (verified alumni only, blocked members
 * already gone) — nothing here re-checks privacy or status.
 */
export function CompanyPage({ companyId, onRequestReferral, onBack, now = Date.now() }: CompanyPageProps) {
  const company = listCompanies().find((c) => c.id === companyId) ?? null;
  const viewer = getCurrentMember();
  const alumni = alumniAt(companyId);
  const openAlumni = alumni.filter((m) => m.openToReferring);

  if (!company) {
    return (
      <div className="p-6">
        <EmptyState title="Company not found" body="It may have been removed, or you may not have access to it." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="w-fit text-sm font-medium text-stone-500 hover:text-stone-700"
        >
          ← Back to directory
        </button>
      ) : null}

      <div>
        <h2 className="text-lg font-semibold text-stone-900">{company.name}</h2>
        <p className="text-sm text-stone-500">
          {alumni.length} XLRI alumni here · {openAlumni.length} open to referring
        </p>
      </div>

      {openAlumni.length === 0 ? (
        <EmptyState
          title="No one here is open to referring right now"
          body="Check back later, or look for alumni at other companies in the directory."
        />
      ) : (
        <Card className="divide-y divide-stone-200">
          {openAlumni.map((m) => {
            // DL1: there is no cap on the seeker here — this checks only the
            // REFERRER's own intake state (open/paused/at-capacity/monthly),
            // never anything about how many requests the viewer has sent.
            const availability = referralAvailabilityFor(m.id, now);
            const isSelf = viewer !== null && viewer.id === m.id;
            return (
              <div key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Avatar name={m.name} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-stone-900">{m.name}</p>
                  <p className="truncate text-xs text-stone-500">
                    {m.programme} · {m.batch}
                    {m.title ? ` · ${m.title}` : ''}
                  </p>
                </div>
                <Chip tone="ok">Open to referring</Chip>
                {isSelf ? null : availability.accepting ? (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() =>
                      onRequestReferral({
                        referrerId: m.id,
                        companyId,
                        roleTitle: '',
                        jobPostId: null,
                        roleUrl: null,
                      })
                    }
                  >
                    Request a referral
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" disabled>
                    {availabilityMessage(availability)}
                  </Button>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
