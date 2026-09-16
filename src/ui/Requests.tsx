import { useState } from 'react';
import { getCurrentMember, getMember, listCompanies, listRequests } from '../data/store.ts';
import { CapacityControls } from './CapacityControls.tsx';
import { REQUEST_STATE_LABEL, RequestDetail, toneForRequest } from './RequestDetail.tsx';
import { Avatar, Card, Chip, EmptyState, Tabs } from './primitives.tsx';

export interface RequestsProps {
  now: number;
}

type Tab = 'sent' | 'incoming';

/**
 * The referral request lists (§5.2): what the viewer has asked for, and what
 * they have been asked. Both tabs read `listRequests()` — already scoped to
 * requests the viewer is a party to (or, for an admin, may read) — and are
 * split into Sent vs. Incoming here by comparing `seekerId`/`referrerId` to
 * the viewer's own id, the same self-check `Directory.tsx` and
 * `CompanyPage.tsx` already make. That is a role split on already-authorized
 * data, not a second visibility filter — `listRequests()` remains the only
 * place that decides who may see a row at all.
 *
 * Capacity controls sit on the Incoming tab: it is the referrer's own intake
 * a viewer is managing there, and DL1 makes that the ONLY volume control left
 * in the product.
 */
export function Requests({ now }: RequestsProps) {
  const viewer = getCurrentMember();
  const [tab, setTab] = useState<Tab>('sent');
  const [openId, setOpenId] = useState<string | null>(null);

  const all = listRequests();
  const companies = listCompanies();
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? 'Undisclosed';

  const sent = viewer ? all.filter((r) => r.seekerId === viewer.id) : [];
  const incoming = viewer ? all.filter((r) => r.referrerId === viewer.id) : [];
  const rows = [...(tab === 'sent' ? sent : incoming)].sort((a, b) => b.updatedAt - a.updatedAt);
  const myRole: 'seeker' | 'referrer' = tab === 'sent' ? 'seeker' : 'referrer';

  return (
    <div className="flex flex-col gap-4 p-6">
      <Tabs
        items={[
          { id: 'sent', label: `Sent (${sent.length})` },
          { id: 'incoming', label: `Incoming (${incoming.length})` },
        ]}
        active={tab}
        onChange={(id) => setTab(id as Tab)}
      />

      {/* Keyed on the viewer so switching personas resets the form instead of
          showing the previous persona's caps under a new name. */}
      {tab === 'incoming' && viewer ? <CapacityControls key={viewer.id} /> : null}

      {rows.length === 0 ? (
        <EmptyState
          title={
            tab === 'sent'
              ? 'You have not asked anyone for a referral yet.'
              : 'Nobody has asked you for a referral yet.'
          }
        />
      ) : (
        <Card className="divide-y divide-stone-200">
          {rows.map((r) => {
            const other = getMember(tab === 'sent' ? r.referrerId : r.seekerId);
            const owed: 'you' | 'them' | 'nobody' =
              r.stateOwner === null ? 'nobody' : r.stateOwner === myRole ? 'you' : 'them';
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setOpenId(r.id)}
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-stone-50"
              >
                <Avatar name={other?.name ?? '?'} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-stone-900">
                    {r.roleTitle || 'Referral request'}
                  </p>
                  <p className="truncate text-xs text-stone-500">
                    {companyName(r.companyId)} · {tab === 'sent' ? 'Asked' : 'From'} {other?.name ?? 'someone'}
                  </p>
                </div>
                {owed === 'you' ? <Chip tone="owed">Needs you</Chip> : null}
                <Chip tone={toneForRequest(r.state, owed)}>{REQUEST_STATE_LABEL[r.state]}</Chip>
              </button>
            );
          })}
        </Card>
      )}

      {openId ? <RequestDetail requestId={openId} now={now} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}
