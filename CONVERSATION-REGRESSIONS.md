# Conversation regression suite

Run from the TradeAssist repository:

```sh
npm run check:conversations -- --baseline=fb8e23c --candidate=working
```

For the reviewed-send, deferral and report-condition follow-up, use the explicit
`--baseline=178465b` and `--holdouts` flags. Previously opened reserved cases are
regressions, not unseen evidence; author a fresh private variation only after the
patch freezes, and retain its first result even if it fails.

For cross-sentence report-release validation, use `--baseline=050f40c` with
`--holdouts`. The lifecycle preflight also exercises shared action/prerequisite
grouping and paired safe/unsafe controller repairs; these are authored scripted
fixtures, not fresh model results or audio-to-screen measurements.

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

Identity probes have two independent outcomes: **identity safety** requires an
actual identity rejection with no invented name published; **same-press
recovery** requires one stable useful card from that original press. Blocking a
bad name alone does not earn a recovery pass. Repair candidates are explicitly
scripted transport inputs, never verified model behavior. When comparing these
outcomes, both builds receive the same bad first draft and safe second draft;
the report does not reinterpret the prior repeated-bad-draft baseline as a new
product improvement.

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

## Scheduled comparison eligibility

`scripts/regression/scheduled-comparison.mjs` declares a recording SHA, annotated
last-word cue, one source-relative request offset, allowed dispatch drift, expected
speech/ASR phase and lifecycle probe before playback. Its local timer calls the
ordinary isolated-app request callback once; operator/tool round trips cannot
change the planned press. It records actual dispatch drift rather than assuming
the timer fired on time.

`validateScheduledRun` and `compareScheduledRuns` reject speed comparisons when
audio, approved input, models, schedule, actual request phase, completed-turn use,
required lifecycle observations or full visible wording do not match. A reuse
comparison must actually start a provisional generation before final recognition;
merely running a build containing the reuse patch is insufficient. A changed
final clause must discard that draft and generate from the completed turn. All
wording and quality results remain available when speed comparison is ineligible.

Each run's raw ASR events are scoped to that intentional request's buyer turn.
An explicit `completed_turn` names every source item in spoken order and contains
their complete assembled text; it is not the last ASR segment alone. All raw
events remain available outside that scoped record. Publication must use the
assembled turn. The run also declares which observation streams were active and
ends with a settled count: zero verification or repairs is different from a
missing observer. Every generation and started check needs a terminal record,
and token/SAY timestamps must belong to the generation actually published.
Pairing also compares observed completed-turn words, ordered source-item contents
and provisional wording. Matching audio and approved pre-call facts cannot hide
different recognition supplied to the model. This check is deliberately literal;
it does not use a model to declare two transcriptions semantically equivalent.

Run the authored protocol and actual-controller proof offline:

```sh
node --no-warnings --experimental-loader ./scripts/regression/typescript-loader.mjs --test tests/scheduled-comparison.test.mjs
```

The reusable `scheduled-lifecycle-worker.mjs SOURCE_ROOT PRIVATE_OUTPUT.json`
drives the selected build's actual controller with the same chronological source
schedule for exact-final reuse and changed-final-meaning cases. Generation, ASR
and visibility callbacks are explicitly scripted; its timings cannot establish
live model/audio/browser speed. Private recorded-audio adapters may use the same
contract, but only an independent full browser paint can finish a live latency
measurement. Missing or mismatched evidence produces no paired speed delta.

### Meaningful input versus audit clocks

New `scheduledContract` records declare versioned comparison policies before a
run. `projectComparisonInput(snapshot, { currentBuyerItemIds })` returns a stable
`projection` for the caller's SHA-256 and a separate list of every excluded
audit-clock field. Attach the **actual captured generation/request snapshot** as
`run.inputEvidence = { snapshot, currentBuyerItemIds,
provenance: 'observed_request_snapshot' }`; scripted transport uses
`'scripted_request_snapshot'`. Expected answers, rubrics and a later recap are
not evidence of what a request received. Without both snapshots, differing old
hashes remain unmatched instead of being assumed to differ only in metadata.

Only explicit schema paths are excluded: current configuration-binding and
request/listening clocks, Brain record/buyer-memory update clocks, current client
preparation review clocks, client-entry recording clocks, and transcript
observation clocks belonging to the current listening session. Earlier-session
transcript dates remain input. A generated `preparation-background:` or
`preparation-update:` entry's `at` is audit-only **only** when its source/type and
timestamps establish that it came from this current review click. A dated buyer
fact, earlier call, agreement deadline, source/version activation/update date,
sending/receipt/approval status, source ID/text/order and every unrecognized field
remain input. This is not a generic removal of fields ending in `At`.
Zero/unset review or configuration-binding timestamps remain state evidence;
normalization cannot turn an unreviewed/unbound request into an approved one.

Run-local request/turn pointers map to their logical transcript positions;
company, client, contact and document-source identities remain literal. Moving a
pointer to a different turn still changes meaning. Raw snapshots, clocks and all
generation/check/cancellation/repair attempts remain in the report; metadata
equivalence does not delete their evidence or their costs.

The speech policy is deliberately narrow: whitespace/apostrophe typography and
a final acknowledgment boundary such as `..., okay?` versus `.... OK?` are
diagnostic formatting when the preceding words are unchanged. It does not
normalize interior punctuation, changed words, references, numbers, conditions,
negation or the ASR item sequence. Standalone `Okay.` and `Okay?` are not assumed
to mean the same thing. Only current transcript text and evidence quoting those
known turns receive this rule; company-document text stays exact. The within-run
check still requires the published snapshot to use the actual complete final
transcript; this cross-run formatting rule cannot excuse losing late speech.

Unknown policy versions fail closed. Archived version-1 contracts retain their
original criteria. A read-only review may explicitly pass
`{ historicalDiagnosticOnly: true }` to classify retained differences under the
new rules, but that review always returns no live timing delta and cannot become
a retroactive speedup claim. A future paid comparison must declare the policy
versions prospectively. Correctness, unavailable replies, timing/visibility,
model differences and incomplete settlement still gate comparison independently.

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

## Document handoff state

Exercise document actions in both directions through live requests and reviewed
call saving/reopening. An offered or promised document remains pending; a
sender's report of sending is distinct from the recipient confirming receipt.
A promised coverage check leaves coverage unknown. Document availability does
not prove that a particular report covers a particular product or buyer reference.
Keep positive-match conditions attached to the report send.

The reviewed recap remains the salesperson's current account. Tests must cover
corrections and removal of an extracted obligation, so original transcript text
cannot silently restore something the reviewer changed. Save/reopen tests use
disposable fictional records and must not modify user history.

## Request-local assessment reuse

The live controller may reuse an assessment only for the exact spoken candidate
and the same immutable pinned context within one work item. A changed transcript
or evidence context retires reuse, as does a repair. Full move checks still run;
no source, authority or delivery-condition requirement is skipped. Phase telemetry
records assessment runs, reuse hits and local assessment time separately.

Offline CPU profiles can establish less repeated local work. They cannot replace
last-word-to-stable-browser-paint measurements. A live comparison should use a
state-corrected control and the same state plus the reuse experiment, with equal
inputs, audio, scheduled press timing and models; comparing against an older
build with different state or prompt input would confound the result.
