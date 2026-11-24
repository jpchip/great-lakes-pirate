import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { NoticeLogEntry } from './notices';

/**
 * The journal's Messages page: the notices that went by bottom left, newest first, so a
 * line that went too fast can be read again (ui/hud/notices).
 */

/** The log, for the ledger's Messages tab wherever the ledger is; absent, no tab. */
export const NoticeLogContext = createContext<readonly NoticeLogEntry[] | undefined>(undefined);

export function useNoticeLog(): readonly NoticeLogEntry[] | undefined {
  return useContext(NoticeLogContext);
}

export function MessagesPage({ log }: { log: readonly NoticeLogEntry[] }) {
  if (!log.length) {
    return <p class="ledger-empty">Nothing to look back on yet.</p>;
  }
  return (
    <ul class="ledger-list notice-log" data-testid="ledger-messages">
      {log.map((e) => (
        <li key={e.id} data-testid="ledger-message">
          <span class="port-dim notice-log-when">{e.when}</span> {e.text}
          {e.count > 1 && <span class="port-dim"> (×{e.count})</span>}
        </li>
      ))}
    </ul>
  );
}
