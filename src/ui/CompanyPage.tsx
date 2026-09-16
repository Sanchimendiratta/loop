import { alumniAt, getCurrentMember, listCompanies, referralAvailabilityFor } from '../data/store.ts';
import type { ReferralAvailability } from '../data/store.ts';
import { Avatar, Button, Card, Chip, EmptyState } from './primitives.tsx';

/**
 * A cold ask at a company: no job post behind it, unlike `ReferralBridgeRequest`
 * (`PostDetail.tsx`), whose `jobPostId` is always real because it only ever
 * fires from a post. Here there may be no post in the picture at all, so
 * `jobPostId` is nullable and `roleTitle` may arrive blank — Task 21's composer
 * is the one place that has to cope with both shapes.
 */
export interface ReferralAsk {
  referrerId: string;
  companyId: string;
  roleTitle: string;
  jobPostId: string | null;
  roleUrl: string | null;
}

export interface CompanyPageProps {
  companyId: string;
  onRequestReferral: (req: ReferralAsk) => void;
  /** Optional: lets a caller (App's directory flow) offer a way back. */
  onBack?: () => void;
  now?: number;
}

/**
 * Reason -> a referrer's own words, per DL1: never a seeker-side quota, always
 * the REFERRER's chosen intake state. Short enough to sit on a disabled
 * button, honest enough that a seeker knows exactly why it is disabled.
 * Shared with `Directory.tsx` so the two surfaces cannot describe the same
 * `reason` two different ways.
 */
const AVAILABILITY_MESSAGE: Record<NonNullable<ReferralAvailability['reason']>, string> = {
  not_open: 'Not open to referring',
  paused: 'Not taking asks right now',
  at_capacity: 'At capacity right now',
  monthly_cap: 'At capacity this month',
};

export function availabilityMessage(a: ReferralAvailability): string {
  if (a.accepting) return '';
  return a.reason ? AVAILABILITY_MESSAGE[a.reason] : 'Not taking referral requests right now';
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
