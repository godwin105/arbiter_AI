/**
 * The invoice product.
 *
 * Reads the invoice from the URL fragment when there is one — that is the
 * client's view, arriving from a shared link — and otherwise shows the creation
 * form, which is the freelancer's view.
 */
import { useEffect, useState } from "react";

import { type Invoice, decodeInvoice } from "./invoice";
import { Books } from "./screens/Books";
import { InvoiceCreate } from "./screens/InvoiceCreate";
import { InvoiceView } from "./screens/InvoiceView";

interface Props {
  usdcAssetId: string;
  explorerBase: string;
}

export function InvoiceApp({ usdcAssetId, explorerBase }: Props) {
  const [fromLink, setFromLink] = useState<Invoice | null>(null);
  const [mine, setMine] = useState<Invoice | null>(null);
  const [books, setBooks] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const read = () => {
      const fragment = location.hash.replace(/^#/, "");
      setFromLink(fragment ? decodeInvoice(fragment) : null);
      setReady(true);
    };
    read();
    // Someone following a second link in the same tab should see it.
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  // The tab title is what a client sees when the link is shared or bookmarked,
  // so it names the invoice rather than the other product in this bundle.
  useEffect(() => {
    document.title = fromLink
      ? `$${fromLink.amount} USDC — invoice from ${fromLink.from}`
      : "Arbiter — invoice, get paid in USDC";
  }, [fromLink]);

  if (!ready) return <div className="centre"><div className="spinner" /></div>;

  if (location.hash.length > 1 && !fromLink) {
    return (
      <div className="shell">
        <h1 className="brand">Broken link</h1>
        <p className="blurb">
          This invoice link is incomplete or was damaged in transit — some apps cut long links
          short. Ask whoever sent it for the full one.
        </p>
        <a className="button" href="/invoice/"
           style={{ display: "block", textAlign: "center", textDecoration: "none" }}>
          Create an invoice instead
        </a>
      </div>
    );
  }

  // A link takes precedence: the client is here to pay, not to create.
  const viewing = fromLink ?? mine;

  if (viewing) {
    return (
      <InvoiceView
        invoice={viewing}
        usdcAssetId={usdcAssetId}
        explorerBase={explorerBase}
        {...(fromLink ? {} : { onBack: () => setMine(null) })}
      />
    );
  }

  if (books) return <Books onBack={() => setBooks(false)} explorerBase={explorerBase} />;

  return <InvoiceCreate onCreated={setMine} onOpen={setMine} onBooks={() => setBooks(true)} />;
}
