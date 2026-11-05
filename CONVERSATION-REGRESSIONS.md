# Conversation regression suite

Run from the TradeAssist repository:

```sh
npm run check:conversations -- --baseline=fb8e23c --candidate=working
```

This command is offline, uses existing dependencies, and does not read credentials,
start listening, make API requests, or touch browser storage. Reports go to ignored
`outputs/conversation-regression/run-<timestamp>/REPORT.private.html` and
`comparison.private.json`. Existing comparisons cannot be overwritten.
No server or browser refresh is required. The salesperson trial remains paused.

For an immutable candidate, replace `working` with its commit. Both builds receive
the same fixture hash. Each build runs in its own process; Git revisions are
extracted to disposable temporary source copies. `working` is identified by its
HEAD, changed paths and complete shared-library source hash, not falsely labelled
as an unmodified commit. The comparison retains every failed buyer moment.

## What the suite exercises

The runner imports the selected build's actual `LiveCoachingSession` and drives
`requestNextMove`, the same entry point called by the live button. It supplies
ordered speech-start, partial, speech-stop and final-transcript events, explicit
representative turns, and one intentional request per fixture press. The real
request snapshots, prompts, parser, local factual/conversation checks, repair
limits and publication ownership execute unchanged. Suggested wording never
becomes actual representative speech. Early-click cases complete the same buyer
turn without a second press. Earlier cards are checked for stability through the
rest of the conversation.

The only scripted boundaries are speech recognition events, generation responses
and remote-verifier responses. They are prominently labelled **SCRIPTED**.
This checks which candidates the product accepts, rejects, repairs or loses. It
does not prove that a real model will choose those candidates, or establish live
speech latency. Scripted semantic-verifier approvals are not evidence that an
unsupported claim is true. Local unsupported claims still take the production
rejection path; direct negative controls must remain blocked.

The existing Regression Lab stays unchanged. It calls `/api/coach` directly and
has older automatic-turn runtime assumptions; it is not equivalent to the live
button. Existing on-demand lifecycle tests remain useful complementary coverage.
No new testing dashboard or Simulator Mode is introduced.

## Fixtures and evaluation

Committed fixtures are deliberately authored fictional analogues of three
conversation families: a report-scope/drawing workflow, purchasing/engineering
deferral, and a prototype/email inquiry. They contain no customer records, saved
transcripts, imported documents, learning examples or credentials.

Each conversation is chronological. Only its current transcript prefix, approved
evidence, reviewed pre-call history and selected stage enter a request. Rubrics,
candidate scripts, historical measurements and final recaps remain outside model
input. Rubrics check the move, preserved reference and conditional commitments;
they permit natural paraphrases instead of comparing complete strings.

Reserved paraphrases and a different-company conversation are enabled with
`--holdouts` after a patch has been written. Do not tune the patch against them.

Private evidence-derived fixture JSON can be supplied separately:

```sh
npm run check:conversations -- --baseline=fb8e23c --candidate=working --fixtures=outputs/private-cases.json --out=outputs/private-comparison
```

Private inputs and all reports must remain under ignored `outputs/`. Review the
fixture's provenance: exact saved request, point-in-time reconstruction, authored
candidate and observed historical output are different kinds of evidence. A
historical rejected draft is not wording the salesperson saw.

## Release interpretation

The report separately records one usable response per press, stability through
close, actual scripted wording, failed checks and reasons, repairs, simulated
verification calls, unavailable replies and input-prefix integrity. It lists
every regression and published safety failure individually. The detector itself
must reject a known broken conditional send and accept safe paraphrases.

The command exits nonzero on any remaining candidate failure, a new regression,
a published safety failure, or a broken detector self-test. An unchanged red
baseline is not a release approval. Conversation totals and challenge-control
totals are separate; rejecting a poisoned draft is not a lost usable reply.

Offline cost is zero. Last-spoken-word-to-visible latency, the 1.8-second target
and provider usage remain **unmeasured**, not zero. Node controller wall time is
reported separately and must never be presented as browser/audio performance.
Historical live observations retain their original tested commit, model,
recording provenance and timing limitations; they are not rerun measurements.

Before a paid comparison, propose the smallest identical-build pair of isolated
live-button/recorded-audio runs, estimated cost, stop limit and decision supported.
Do not run it until the user authorizes it. Reuse the existing audio/browser
adapter and real `recordBuyerAcousticEnd`/`recordReplyPaint` instrumentation.
Never synthesize a screen-paint timestamp from a controller publication event.

## Blocking-rule audit

| Gate in the active live path | Concrete harm it prevents | Safe paired behavior |
| --- | --- | --- |
| Company evidence, numeric scope and document/product linkage | Invented specification, price, availability or report coverage | A promise to check whether coverage exists is not a claim that it does |
| Configuration authority and commercial boundaries | Unauthorized discount, shipment, certification or guarantee | Seek approval or verify the requested fact without promising the result |
| Delivery release/positive-match conditions | Sending despite the buyer's explicit condition or approval hold | Send only if coverage matches; checking and then sending is insufficient |
| Buyer reference versus catalogue identity | Turning a buyer drawing code into an unsupported supplier product | Echo the complete confirmed reference while retaining uncertainty about coverage |
| Current speaker, transfer and current listening-session identity | Addressing a contact who has not joined or answering historical speech | Wait during transfer, then introduce the rep/company when pickup is confirmed |
| Request snapshot/final-transcript ownership | Publishing a stale draft after the buyer's final clause changes meaning | Retain the original click, refresh unpublished work, keep displayed wording stable |
| Prior commitments, review/send/approval state | Claiming sent, received, reviewed or approved without evidence | Preserve unknowns and distinguish a promise from completion |
| Refusal, deferral, selected next step and relevance | Reopening discovery after refusal/deferral or losing the buyer's chosen action | Acknowledge and propose one permitted useful next step |
| Spoken-text extraction, language and internal metadata | Exposing internal instructions or unusable advice as words to say | Recover an unambiguous SAY paragraph and validate that text |
| Source-check result/timeout and bounded repair lifecycle | Unsupported output or an indefinitely hanging request | Log rejection, permit bounded repair, publish a visible unavailable status |
| Rejected learning examples | Repeating an explicitly rejected move in the same company/situation | Retrieve relevant corrections without leaking another company's facts |
| Word budget | Delivery quality, not a factual/authority safety harm | On-demand overlength is quality feedback, not a publication blocker |

The suite audits both local assessment and final conversation checks. A local
pass alone is not publication. A remote check alone cannot override a buyer's
condition or an active commercial boundary.
