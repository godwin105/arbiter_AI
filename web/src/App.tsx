/**
 * Arbiter — reviewer app.
 *
 * The supply side of the human judgment marketplace. Agents pay for judgments
 * they cannot make alone; this is where a person actually answers them.
 *
 * Navigation is a small state machine rather than a router: four screens and one
 * linear flow, so a router would add a dependency without removing complexity.
 */
import { useEffect, useRef, useState } from "react";

import { type QueuedTask, type StoredWorker, clearWorker, loadWorker, saveWorker } from "./api";
import { Toast } from "./components/Chrome";
import { InvoiceApp } from "./InvoiceApp";
import { Earnings } from "./screens/Earnings";
import { Queue } from "./screens/Queue";
import { SignIn } from "./screens/SignIn";
import { TaskDetail } from "./screens/TaskDetail";

type Screen = { name: "queue" } | { name: "task"; task: QueuedTask } | { name: "earnings" };

export default function App() {
  // One bundle serves both products; the path decides which. They share the
  // styling and the API client, and neither needs a router.
  if (location.pathname.startsWith("/invoice")) {
    return (
      <InvoiceApp
        usdcAssetId={import.meta.env.VITE_USDC_ASSET ?? "10458941"}
        explorerBase={import.meta.env.VITE_EXPLORER ?? "https://lora.algokit.io/testnet"}
      />
    );
  }
  return <ReviewerApp />;
}

function ReviewerApp() {
  useEffect(() => {
    document.title = "Arbiter — review work, get paid in USDC";
  }, []);

  const [worker, setWorker] = useState<StoredWorker | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: "queue" });
  const [restoring, setRestoring] = useState(true);

  // A submitted answer leaves the screen it came from, so the confirmation has
  // to live above the screens rather than inside the one being unmounted.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  function announce(message: string) {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // A reviewer who has already signed in should land straight in the queue.
  useEffect(() => {
    setWorker(loadWorker());
    setRestoring(false);
  }, []);

  if (restoring) {
    return (
      <div className="centre">
        <div className="spinner" />
      </div>
    );
  }

  if (!worker) {
    return (
      <SignIn
        onRegistered={(registered) => {
          saveWorker(registered);
          setWorker(registered);
          announce(`Welcome, ${registered.displayName}`);
        }}
      />
    );
  }

  return (
    <>
      {screen.name === "task" ? (
        <TaskDetail
          baseUrl={worker.baseUrl}
          token={worker.token}
          task={screen.task}
          onDone={(payoutUsdc) => {
            setScreen({ name: "queue" });
            announce(`Answer submitted · $${payoutUsdc} USDC queued`);
          }}
          onCancel={() => setScreen({ name: "queue" })}
        />
      ) : screen.name === "earnings" ? (
        <Earnings
          baseUrl={worker.baseUrl}
          token={worker.token}
          onBack={() => setScreen({ name: "queue" })}
          onSignOut={() => {
            clearWorker();
            setWorker(null);
            setScreen({ name: "queue" });
          }}
        />
      ) : (
        <Queue
          baseUrl={worker.baseUrl}
          token={worker.token}
          displayName={worker.displayName}
          onOpenTask={(task) => setScreen({ name: "task", task })}
          onOpenEarnings={() => setScreen({ name: "earnings" })}
        />
      )}
      {toast ? <Toast message={toast} /> : null}
    </>
  );
}
