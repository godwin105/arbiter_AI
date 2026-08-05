# What Arbiter actually does

*Written for someone who does not work with computers for a living. No code, no
jargon that is not explained.*

---

## The one-sentence version

**AI assistants are starting to spend money on people's behalf, and they cannot
tell a normal payment from a trap. Arbiter is the second opinion they buy before
they act — about a fifth of a penny per question.**

---

## The problem, with an analogy

Imagine you hire an assistant who is extraordinarily capable. They read any
document instantly, work all night, never get bored, and do exactly what you ask.

But they have no street smarts. They have never been warned about anything.

One day a letter arrives. It says *"Sign here to confirm your address — no money
will change hands."* Your assistant reads it, sees that no money changes hands,
and signs it.

The letter was not about your address. Buried in the wording, it signed over
control of your bank account to a stranger. Nothing happened that day. Two weeks
later the account is empty.

Your assistant did nothing wrong by their own reasoning. They read what was in
front of them, checked that no money was moving, and acted. **They just did not
know what they were looking at.**

That is exactly the situation with AI agents today. They are being given the
ability to pay invoices, move funds, and sign agreements — and they have no
instinct for danger.

---

## What Arbiter is

Arbiter is a service the assistant can consult *before* it acts.

It reads the thing the assistant is about to sign, works out what would actually
happen, and answers in plain terms:

| Answer | Means |
|---|---|
| **Allow** | Nothing wrong here. Go ahead. |
| **Warn** | This is risky. Only proceed if a person has accepted the risk. |
| **Block** | Do not do this. It would very likely cost you money. |
| **Escalate** | I could not tell. **This is not permission** — ask a person. |

And it always says *why*, in sentences a human can read.

The whole exchange takes under a second and costs a fraction of a penny.

---

## Four things it catches

These are real, and all four are things a capable AI would otherwise walk into.

### 1. The document that signs away the account

A payment that says it moves **zero** money. Most software shows it as harmless —
nothing is moving, so what is the risk?

Hidden in it is an instruction that permanently hands control of the account to
someone else. Every future payment would be authorised by *them*, not you.

Arbiter reads that instruction and says: **Block. This transfers control of your
account to a stranger.**

### 2. The permission slip

Signing something that lets a company take money from your account — not once,
but **any amount, any time, forever**.

The dangerous part is that nothing happens when you sign it. Your balance does
not change. There is nothing to notice. The money leaves next week, or next
month, and by then nobody connects it to the thing you signed.

Arbiter flags the permission itself, at the moment it is granted.

### 3. The invoice with the wrong bank details

Your supplier sends an invoice. The company name is right, the amount is right,
the logo is right. Someone has changed the account number.

You pay. The money is gone, and your supplier still wants paying.

This is one of the most common frauds in business, and an AI reading the invoice
has no way to spot it — everything on the page is correct.

Arbiter checks the account number against who the supplier actually is, and says:
**Block. This account does not belong to them.**

### 4. The payment that silently never arrives

On the payment network Arbiter uses, an account has to switch on the ability to
receive a particular kind of money before it can receive it. If it has not, the
payment is refused.

It does not bounce back with an error. It does not appear anywhere. It simply
never happened — and neither side is told.

Arbiter checks first, so you find out before you send rather than three weeks
later when someone chases the invoice.

---

## The part where real people get paid

Some questions no computer can answer.

*Does this photograph show a parcel actually left at a front door? Does this shop
exist at this address? Is this receipt genuine?*

When an AI hits a question like that, Arbiter sends it to real people. They look,
they answer, and they say what they saw. Several people answer independently, and
the answers are compared before a result is returned.

Those reviewers get paid, in digital dollars, straight to their own account.
There is nothing to install — it works in a normal web browser, and there is no
account to open with us.

Two deliberate choices:

- **Reviewers are paid for answering, not for agreeing.** If you paid people for
  matching everyone else, they would stop looking at the evidence and start
  guessing what the crowd would say. That would quietly destroy the whole point.
- **Their answers include what they actually saw**, not just yes or no. "Brown box
  on the doormat, label facing up" is checkable. "Yes" is not.

---

## How the money works

There is no subscription, no sign-up, no sales call, no invoice.

The AI asks a question. Attached to the question is a payment of a fraction of a
penny, handled automatically. The answer comes back. That is the entire
transaction.

| Question | Cost |
|---|---|
| Is this safe to sign? | about a fifth of a penny |
| Is this really who I am paying? | about one penny |
| What would a person say? | about twenty pence |

The prices are deliberately tiny for the first two. A safety check that costs
almost nothing is one an AI can afford to run on **every single action** — and
running it on everything is the point. The moment it becomes expensive enough to
think about, someone starts guessing which actions are risky, and guessing is
exactly the thing that fails.

The digital dollars are called USDC. One USDC is one US dollar. Payments settle
in a few seconds on a payment network called Algorand.

---

## Who uses it

**Businesses running AI assistants that touch money.** Anyone whose AI pays
suppliers, moves funds, or signs agreements. Arbiter is the check between the AI
deciding to do something and it actually happening.

**Developers building AI agents.** It plugs into the common tools for building
agents, so adding the safety check is a couple of lines rather than a project.

**People who want to earn.** Anyone with a phone or a browser can answer
questions and get paid.

---

## Why it needs to exist now

Until recently, an AI could only suggest. A person still pressed the button, and
that person was the safety check.

Agents now press the button themselves. The safety check that used to be a human
glancing at the screen is gone, and nothing replaced it.

Arbiter is the replacement. Not a person watching every action — that would
defeat the purpose of automating it — but a service that reads every action in
under a second, costs almost nothing, and knows what danger looks like.

---

## Seeing it work

The website runs the checks **live**, on real examples, every time the page is
opened. It is not a video or a screenshot — the results shown were worked out at
the moment you loaded the page.

- **The product:** https://arbiter-hs23.onrender.com
- **Earn by reviewing:** https://arbiter-hs23.onrender.com/work/
- **For developers:** https://arbiter-hs23.onrender.com/docs

---

## Honest status

It is real and it works. Money has genuinely moved — AI agents have paid for
answers, and a reviewer has been paid for their work, both settled on a public
payment network where anyone can verify it.

It is currently running on a **test network**, which behaves exactly like the
real one but uses practice money. Moving to real money is a configuration
change, not a rebuild.
