import { useCallback, useEffect, useState } from "react";

import { type QueuedTask, fetchQueue, timeUntil } from "../api";

interface Props {
  baseUrl: string;
  token: string;
  displayName: string;
  onOpenTask: (task: QueuedTask) => void;
  onOpenEarnings: () => void;
}

export function Queue({ baseUrl, token, displayName, onOpenTask, onOpenEarnings }: Props) {
  const [tasks, setTasks] = useState<QueuedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setTasks(await fetchQueue(baseUrl, token));
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

  if (loading) {
    return (
      <div className="centre">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="header">
        <div>
          <h2 className="title">Available work</h2>
          <p className="subtitle">Signed in as {displayName}</p>
        </div>
        <button className="chip" onClick={onOpenEarnings}>
          Earnings
        </button>
      </header>

      {error ? <p className="error">{error}</p> : null}

      {tasks.length === 0 ? (
        <div className="empty">
          <p className="empty-title">Nothing to review right now</p>
          <p className="empty-body">
            Questions appear here the moment an agent asks one. This list refreshes on its own.
          </p>
        </div>
      ) : (
        tasks.map((task) => (
          <button key={task.taskId} className="card" onClick={() => onOpenTask(task)}>
            <div className="row-between">
              <span className="payout">${task.payoutUsdc} USDC</span>
              <span className="expiry">{timeUntil(task.expiresAt)}</span>
            </div>

            <p className="question-preview">{task.question}</p>

            <div className="row-between">
              <span className="meta">
                {task.attachments.length > 0
                  ? `${task.attachments.length} attachment${task.attachments.length === 1 ? "" : "s"}`
                  : "No attachments"}
              </span>
              <span className="meta">
                {task.responsesReceived}/{task.quorum} reviewers
              </span>
            </div>
          </button>
        ))
      )}
    </div>
  );
}
