# Credit-Approved

A web game where you play a Project Finance Analyst and decide which projects the bank should fund, and on what terms.

Each case is a real-looking credit file with hidden traps. You read the documents, test your own assumptions in a live financial model, send a proposal to the credit committee, then defend it in a chat with the committee members. The game scores your analysis, your decision, your conditions and your written answers.

Designed for a computer screen (laptop or desktop), for classes, interview practice and recruiting.

## How a game works

1. **Read the case.** Deal summary, sponsor business plan, independent engineer report, and an "Others" tab for extra information some cases need. The front office may message you in the chat.
2. **Test the numbers.** The control center opens on the sponsor's assumptions. Change yield, curtailment, tariff, operating costs and loan amount: production, CFADS, debt service, DSCR, max debt and gearing update live, with charts over the loan's life. The sponsor case stays on the charts in grey dashed lines.
3. **Send a proposal.** Approve as requested, approve with conditions, or decline. Pick conditions carefully: some protect the bank, some are useless, and too many push the sponsor to a competitor.
4. **Defend it.** Committee members question you one by one, each in their own conversation. You keep the documents and the control center on screen while answering.
5. **See the outcome.** What happens to the deal, the effect on three gauges (bank revenue, portfolio risk, credibility), your score out of 20, a debrief and the full answer key.

### Cases

| Case | Level | Traps |
| --- | --- | --- |
| 01 · Bright River Solar (Vietnam) | Tutorial | Inflated energy yield, curtailment ignored |
| 02 · Amihan Wind (Philippines) | Intermediate | PPA shorter than the debt, operating costs after the warranty, single-group exposure limit, incomplete KYC |

### Score (out of 20)

| Part | Case 01 | Case 02 | What counts |
| --- | --- | --- | --- |
| Analysis | 6 | 5 | The traps you spotted: control center values, or conditions ticked, when you sent the proposal |
| Decision | 4 | 4 | The outcome your proposal leads to |
| Conditions | 4 | 3 | +1 per good condition, −1 per bad one (case 01 also gives +1 for a clean structure) |
| Committee | 6 | 8 | 0 to 2 per answer: the expected ideas (judged by an AI model), backed by numbers |

**AI grading of committee answers.** Each answer is sent, as soon as the player sends it, to a small relay (`worker/`, a Cloudflare Worker) that asks an LLM (Groq, `openai/gpt-oss-120b`) which of the expected ideas the answer asserts, quoting it. The points then come from the game rules: expected numbers, `minIdeas`, 0 to 2. On the result screen each answer shows "AI-analysed" and the committee's feedback. If the relay does not answer within 12 seconds, or is over its limits, that answer is graded with keywords and shows "Keyword-analysed"; the game never waits longer nor breaks. Add `?ai=0` to the address to grade with keywords only. Answers are sent to the relay and the LLM provider for grading; Credit Approved does not store them, and the welcome screen says so.

Without AI, committee answers are analysed with keywords and numbers. Numbers are read in any format (`1,430`, `1.430`, `1 430`; `26m`, `26 million`, `26,000,000`; `1.20x`, `1,20x`).

**Semantic analysis (observation).** A second score is computed with a small open-source model that runs in the player's browser ([Transformers.js](https://huggingface.co/docs/transformers.js) and `all-MiniLM-L6-v2`). It does not change the official score yet. For each idea, the closest pair between a sentence of the answer and the idea's `examples` gives a similarity: at or above `high` (0.55 by default) the idea is found; between `low` (0.35) and `high`, only with one of its keywords; below `low`, it is missing. Trap numbers then refuse ideas (for example, the sponsor's yield quoted without the engineer's P90). The 0 to 2 scale is unchanged. If the model cannot load, keywords are used alone.

Add `?debug=1` to the address (http://localhost:8000/?case=case-01&debug=1) to load the model and see, on the result screen, both scores for every answer and idea, with the AI grading next to them and a button to export the answers and all the scores as JSON. Without `?debug=1` the model is not downloaded. The semantic model runs in the browser and sends nothing: only the library (from jsdelivr) and the model weights (about 23 MB, from huggingface.co) are downloaded, then cached.

## Play it on your computer

The game loads its case from a JSON file, which browsers refuse to do when you double-click `index.html`. Start a small local server from the project folder (Python comes with macOS):

```
python3 -m http.server 8000
```

Then open http://localhost:8000 in your browser. Stop the server with Ctrl+C.

The welcome screen lists every case in `cases/index.json`. To send players straight to one case (for a class, for example), add its name to the address: http://localhost:8000/?case=case-02 shows only that case.

## Run the tests

Requires [Node.js](https://nodejs.org) (nothing else to install):

```
node tests/model.test.js
node tests/game.test.js
node tests/grader.test.js
node tests/worker.test.mjs
node tests/audit.test.js
```

(or `npm test`, which runs them all.) `grader.test.js` checks the LLM grading prompt and the reading of its reply, without any network call.

`model.test.js` checks the financial formulas against reference figures. `game.test.js` checks the outcome, conditions, competition, score and gauge rules, and the analysis of committee answers. `audit.test.js` tries tens of thousands of proposals on every case and checks that the outcome, the score, the result table and the answer key never contradict each other: run it after creating or editing a case.

### The grading relay (Cloudflare Worker)

`worker/index.js` answers `POST /grade` with `{ caseId, question, answer }`. It builds the prompt itself from the case published on the site (the player never sends a prompt), calls the LLM with the API key kept as a Cloudflare secret, and returns the ideas, quotes and feedback. It only accepts the game's own origins (`ALLOWED_ORIGINS`), checks the inputs before any LLM call, and allows 40 graded answers per minute per IP address (a class may share one). Settings are in `worker/wrangler.toml`; `tests/worker.test.mjs` runs it in Node with a fake site and a fake LLM.

To deploy after a change (Wrangler is a dev dependency, logged in once with `npx wrangler login`):

```
npx wrangler deploy --config worker/wrangler.toml
```

The API key is set once with `npx wrangler secret put LLM_API_KEY --config worker/wrangler.toml`. The relay reads cases from the live site and keeps them 5 minutes, so push case changes first.

### Evaluate the LLM grader

`js/grader-prompt.js` builds the grading prompt from the case (`graderContext`, the question, `goodAnswer`, each idea's `claim`) and checks the LLM's JSON reply: an idea counts only when its quote is really in the answer. The LLM only says which ideas the answer asserts; the points come from the game rules (`evaluateAnswerLLM` in `js/game.js`: expected numbers, `minIdeas`, 0 to 2). Trap numbers do not veto the LLM's ideas, since it already tells a quoted figure from a rejected one; without a usable reply, keywords and trap numbers are used.

To call a real LLM, put an API key in a `.env` file at the project root (git-ignored, never committed): `GROQ_API_KEY=...`. Any provider with the OpenAI chat format works (`LLM_URL`, `LLM_MODEL`, `LLM_API_KEY` in `.env`). Then:

```
node --env-file=.env tests/llm.eval.js tests/answers/case-01.json
```

It prints, for every answer, the expected points, the keyword points and the LLM points, then the errors of each method, failed calls, tokens used, and the LLM's quotes and feedback where it disagrees. `tests/answers/claude-probes-*.json` are probes written by Claude to aim at known weak spots; the analyst's own graded answers are the reference.

### Evaluate the semantic analysis

The tests above use fixed similarity scores, so they run without the model and without installing anything. To measure the real model against your own grading, one install is needed (it downloads the library into `node_modules/`, which is not published):

```
npm install
node tests/semantic.eval.js tests/answers/case-01.json
```

An answer file lists answers you graded yourself:

```json
{
  "case": "case-01",
  "answers": [
    { "question": 0, "text": "...", "expected": { "points": 1, "ideas": [true] }, "note": "..." }
  ]
}
```

`question` is the index in `committee`, `ideas` has one entry per idea of that question (`true`, `false`, or `null` when not graded). The JSON exported from the debug panel has the same shape: fill its `expected` fields and copy the answers in. The script prints, for both methods, the answers with the wrong points and the ideas wrongly found or missed, then the similarity spread and the thresholds with the fewest errors. Aim for 30 answers or more, good and bad, before trusting the suggested thresholds.

## Project structure

```
index.html            Page skeleton: welcome, case and result screens, chat
css/style.css         All styles
js/model.js           Financial calculations only (no display, no game rules)
js/semantic.js        Sentence similarity with the in-browser model (no game rules)
js/ui.js              Everything the player sees (no calculations, no rules)
js/game.js            Game rules (score, outcome, gauges, answer analysis) and game flow
cases/index.json      The list of cases shown on the welcome screen
cases/case-0X.json    Case data: documents, model inputs, conditions, questions, rules, debrief
content/case-0X.md    The same case written for humans (design document)
js/grader-prompt.js   Prompt for the LLM grader and the strict reader of its reply (no network)
tests/                Tests, run with Node; tests/answers/ holds graded answers for the evaluations
worker/               The grading relay (Cloudflare Worker) and its settings
package.json          Only for the evaluation scripts and the relay (npm install); the game needs no install
```

Charts use [Chart.js](https://www.chartjs.org) and the semantic analysis uses [Transformers.js](https://huggingface.co/docs/transformers.js), both loaded from a CDN. There is no framework and no build step.

## Add a new case

A case is one JSON file in `cases/`, plus one line in `cases/index.json` so it appears on the welcome screen. No code to change: copy the closest existing case (case 01 for constant assumptions, case 02 for assumptions that change over time), rename it (for example `case-03.json`), edit it, and add it to the index. Write the case in a markdown file in `content/` first; it is easier to review than JSON.

Main sections of the file:

| Key | What it holds |
| --- | --- |
| `id`, `title`, `country`, `tagline`, `level`, `readingTime` | Case header shown above the documents |
| `documents` | The tabs. Each has a `tab` name, a `title`, a `source` and a list of `blocks`. Block types: `table` (`head`, `rows`), `heading`, `paragraph`, `quote`, `callout` (highlighted text), `list` (`items`), `message` (`from`, `text`), `exposure` (a limit bar: `group`, `outstanding`, `limit`, `unit`), `orgchart` (`levels`: rows of boxes with `name`, `note`, `stake`, `borrower`). A tab with no blocks shows its `empty` text |
| `messages.onStart` | Chat messages that arrive while the player reads the case (`from`, `role`, `text`, `delay` in milliseconds) |
| `messages.committeeClosing` | The message that ends the committee session |
| `model.fixed` | Fixed parameters: `capacity` (and `capacityUnit`), `totalCost` (USD m), `tenor` (years, unless it is a slider), `rate` (0.07 = 7%), `minDSCR`, `warnDSCR` (amber threshold), `maxGearing`. Optional, for assumptions that change over time: `ppaYears` (after which `merchantPrice` replaces `tariff`), `merchantMinDSCR` (the bank's minimum on those years), `warrantyYears` (after which `opexAfter` replaces `opex`). `neutralMetrics: true` shows the key metrics without help: only the player's value and the sponsor case, no colours, thresholds or max debt |
| `model.sponsorCase` | The sponsor's value for every slider, where the control center opens, plus the `loan` requested |
| `model.inputs` | The control center sliders: `label`, `unit`, `min`, `max`, `step`. The key is the model input it sets (`yield`, `curtailment`, `tariff`, `merchantPrice`, `opex`, `opexAfter`, `tenor`). Add `"percent": true` when the value is typed in % (curtailment 10 = 10%) |
| `proposal.requestedLoan`, `proposal.loan` | Amount requested and the loan slider range |
| `proposal.decisions` | The three decisions and their hints |
| `proposal.conditions` | Each condition is good (`points` +1) or bad (−1): `label`, `role`, `points`, `burden` (weight on the sponsor), optional `gauges` effect, `reason` shown in the result. Optional: `rateIncrease` (0.005 = +50 bp), `redundantIfLoanAtMost` with `redundantPoints` and `redundantReason` for a condition that is only good when the loan is large enough |
| `committee` | The questions, in order. Each person (`askedBy`) gets their own conversation. `analysis` lists the expected `ideas` (each with `any`: every accepted wording, and `examples`: 2 to 4 short reference sentences written the way a player would, for the semantic analysis, and `claim`: one sentence stating the idea, which the LLM grader checks), how many are needed (`minIdeas`), and the accepted `numbers` (`values`, optional `unit: "%"` and `tol`). Optional `trapNumbers`: each has a `label`, `values`, `unlessAny`, the `ideas` it refuses (indices) and a `feedback`; when the answer quotes one of `values` and none of `unlessAny`, those ideas are refused. Check that a good answer cannot quote the trap number alone. Optional `semantic` (`high`, `low`) overrides the similarity thresholds for this question |
| `semantic` | Optional: `high` and `low` similarity thresholds for the whole case (defaults 0.55 and 0.35 in `js/game.js`) |
| `graderContext` | The case's key facts in a few lines (parties, key figures, the bank's limits), given to the LLM grader so it understands names and numbers in the answers |
| `committeeScale` | What 0, 1 and 2 points mean, shown in the result |
| `rules.outcomeChecks` | Checks tried in order for any approval (as requested or with conditions), in the order of a real deal; the first that fails decides the outcome, and if none fails the outcome is `right`. Types: `policy` (Risk: gearing within `maxGearing` and loan within the bank's policy on the official `bankCase`, for the tenor proposed, unless a condition in `unlessAny` is ticked), `maxLoan` (`max`, unless a condition in `unlessAny` is ticked), `burden` (too heavy for the sponsor), `conservative` (loan below `minShare` of what policy allows on the `bankCase`), `requireCondition` (a condition must be ticked) |
| `rules.competition` | `sponsor` (the short name shown on the result screen), `maxBurden` before the sponsor walks away, and the weight of a `loanCutBurden` and `tenorCutBurden`. The result screen shows it as the sponsor's patience: each condition's points and the patience it uses, against that limit |
| `rules.score` | Traps: each has `points` and a list `any` of tests, spotted if one passes: `{ input, test: "range", min, max }`, `{ input, test: "max" or "min", value }`, `{ condition }` or `{ loanAtMost }`. Then points per decision outcome, `decisionNeedsTraps` and `decisionWithoutTraps` (a right decision earns fewer points when those traps were missed), conditions `max` and `cleanBonus`, points per committee answer |
| `outcomes` | One entry per outcome used (`right`, `weak`, `approve`, `decline`, `lost`, and any outcome named in `outcomeChecks`): `label`, `story`, `gauges` moves (one point = 10 on a 0 to 100 gauge), and `closes: true` when the deal goes ahead (the conditions' own gauge effects then apply) |
| `debrief`, `answerKey` | Shown only on the result screen. `answerKey.best` is the best answer the player is compared with (`decision`, control center `assumptions`, `loan`, `conditions`, `note`). `answerKey.tables` holds the answer key's tables (`note`, `head`, `rows`, optional `footer`). `debrief.spotted` explains each trap, in the same order as `rules.score.traps` |

Everything in `rules`, `outcomes`, `debrief` and `answerKey` is only displayed at the end of the game. The file itself is public once the site is online, so a curious player could read it: keep that in mind for graded sessions.

After editing a case, check that the JSON is valid (an online JSON validator works, or `python3 -m json.tool cases/case-02.json`) and play it once from start to finish.
