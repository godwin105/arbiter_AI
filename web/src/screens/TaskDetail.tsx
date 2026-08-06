import { useEffect, useRef, useState } from "react";

import { type QueuedTask, submitAnswer, timeUntil } from "../api";
import { TopBar } from "../components/Chrome";

interface Props {
  baseUrl: string;
  token: string;
  task: QueuedTask;
  onDone: (payoutUsdc: string) => void;
  onCancel: () => void;
}

export function TaskDetail({ baseUrl, token, task, onDone, onCancel }: Props) {
  const [answer, setAnswer] = useState("");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Time spent is reported to the server, which flags implausibly fast answers
  // as a quality signal. Measured from when the question is first shown.
  const openedAt = useRef(Date.now());
  useEffect(() => {
    openedAt.current = Date.now();
  }, [task.taskId]);

  const canSubmit = answer.trim().length > 0 && rationale.trim().length > 0 && !busy;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(null);
    try {
      await submitAnswer(
        baseUrl,
        token,
        task.taskId,
        answer.trim(),
        rationale.trim(),
        Date.now() - openedAt.current,
      );
      onDone(task.payoutUsdc);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar
        baseUrl={baseUrl}
        right={<span className="expiry">{timeUntil(task.expiresAt)}</span>}
        onBrandClick={onCancel}
      />

      <form className="shell wide fade-in" onSubmit={submit}>
        <button type="button" className="link" onClick={onCancel}>
          ← Queue
        </button>

        {/* Evidence on one side, the answer on the other: on a wide screen a
            reviewer should not have to scroll away from the photograph they are
            being asked about. On a phone it stacks in reading order. */}
        <div className="split" style={{ marginTop: 14 }}>
          <div>
            <span className="payout">${task.payoutUsdc} USDC</span>
            <h2 className="question">{task.question}</h2>

            {task.attachments.map((url) => (
              <img key={url} className="attachment" src={url} alt="Evidence for this question" />
            ))}

            <p className="hint" style={{ marginTop: 14 }}>
              {task.responsesReceived}/{task.quorum} reviewers have answered so far.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="answer" style={{ marginTop: 0 }}>
              Your answer
            </label>
            {task.options ? (
              <div className="options">
                {task.options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="option"
                    aria-pressed={answer === option}
                    onClick={() => setAnswer(option)}
                    disabled={busy}
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : (
              <input
                id="answer"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Type your answer"
                disabled={busy}
              />
            )}

            <label className="label" htmlFor="rationale">
              What did you see?
            </label>
            <textarea
              id="rationale"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Package visible on the doormat, label facing up."
              disabled={busy}
            />
            <p className="hint">
              Describe the evidence, not your conclusion. Reviewers are paid for answering, not
              for agreeing with each other — report what you actually see.
            </p>

            {error ? <p className="error">{error}</p> : null}

            <div className="sticky-actions">
              <button className="button" type="submit" disabled={!canSubmit}>
                {busy ? "Submitting…" : `Submit answer · $${task.payoutUsdc}`}
              </button>
            </div>
          </div>
        </div>
      </form>
    </>
  );
}
