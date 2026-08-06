import { useCallback, useEffect, useState } from "react";

import { type QueuedTask, fetchQueue, timeUntil } from "../api";
import { CardSkeletons, TopBar } from "../components/Chrome";

interface Props {
  baseUrl: string;
  token: string;
  displayName: string;
  onOpenTask: (task: QueuedTask) => void;
  onOpenEarnings: () => void;
}

/** Under ten minutes is worth flagging: an agent is blocked on the other end. */
const isUrgent = (iso: string) => Date.parse(iso) - Date.now() < 10 * 60_000;

const clock = (at: Date) =>
  at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function Queue({ baseUrl, token, displayName, onOpenTask, onOpenEarnings }: Props) {
  const [tasks, setTasks] = useState<QueuedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setTasks(await fetchQueue(baseUrl, token));
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [baseUrl, token]);

  useEffect(() => {
    void load().finally(() => setLoading(false));

    // Questions arrive while the reviewer is looking at the list, and an agent
    // is blocked waiting on the other end — so the queue refreshes itself.
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const open = tasks.length;

  return (
    <>
      <TopBar
        baseUrl={baseUrl}
        right={
          <button className="chip" onClick={onOpenEarnings}>
            Earnings
          </button>
        }
      />

      <div className="shell wide">
        <header className="header">
          <div>
            <p className="eyebrow">queue</p>
            <h2 className="title">
              {loading ? "Available work" : open === 0 ? "All clear" : `${open} to review`}
            </h2>
            <p className="subtitle">Signed in as {displayName}</p>
          </div>
        </header>

        {error ? <p className="error">{error}</p> : null}

        {loading ? (
          <CardSkeletons count={3} />
        ) : open === 0 ? (
          <div className="empty fade-in">
            <div className="empty-glyph" aria-hidden="true">
              ◇
            </div>
            <p className="empty-title">Nothing to review right now</p>
            <p className="empty-body">
              Questions appear here the moment an agent asks one. This list refreshes on its
              own — you can leave it open.
            </p>
          </div>
        ) : (
          <div className="card-grid fade-in">
            {tasks.map((task) => (
              <button key={task.taskId} className="card" onClick={() => onOpenTask(task)}>
                <div className="row-between">
                  <span className="payout">${task.payoutUsdc} USDC</span>
                  <span className={`expiry${isUrgent(task.expiresAt) ? " urgent" : ""}`}>
                    {timeUntil(task.expiresAt)}
                  </span>
                </div>

                <p className="question-preview">{task.question}</p>

                <div className="row-between">
                  <span className="meta">
                    {task.attachments.length > 0
                      ? `${task.attachments.length} attachment${task.attachments.length === 1 ? "" : "s"}`
                      : "no attachments"}
                  </span>
                  <span className="meta" title={`${task.responsesReceived} of ${task.quorum} reviewers`}>
                    <span className="pips" aria-hidden="true">
                      {Array.from({ length: task.quorum }, (_, i) => (
                        <i key={i} className={i < task.responsesReceived ? "on" : ""} />
                      ))}
                    </span>{" "}
                    {task.responsesReceived}/{task.quorum}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}

        {updatedAt ? (
          <p className="hint" style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 8 }}>
            <span className="pips" aria-hidden="true">
              <i className="on" />
            </span>
            Updated {clock(updatedAt)} · refreshing every 15s
          </p>
        ) : null}
      </div>
    </>
  );
}
