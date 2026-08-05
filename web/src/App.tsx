/**
 * Arbiter — reviewer app.
 *
 * The supply side of the human judgment marketplace. Agents pay for judgments
 * they cannot make alone; this is where a person actually answers them.
 *
 * Navigation is a small state machine rather than a router: four screens and one
 * linear flow, so a router would add a dependency without removing complexity.
 */
import { useEffect, useState } from "react";

import { type QueuedTask, type StoredWorker, clearWorker, loadWorker, saveWorker } from "./api";
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
  const [worker, setWorker] = useState<StoredWorker | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: "queue" });
  const [restoring, setRestoring] = useState(true);

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
        }}
      />
    );
  }

  if (screen.name === "task") {
    return (
      <TaskDetail
        baseUrl={worker.baseUrl}
        token={worker.token}
        task={screen.task}
        onDone={() => setScreen({ name: "queue" })}
        onCancel={() => setScreen({ name: "queue" })}
      />
    );
  }

  if (screen.name === "earnings") {
    return (
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
    );
  }

  return (
    <Queue
      baseUrl={worker.baseUrl}
      token={worker.token}
      displayName={worker.displayName}
      onOpenTask={(task) => setScreen({ name: "task", task })}
      onOpenEarnings={() => setScreen({ name: "earnings" })}
    />
  );
}
