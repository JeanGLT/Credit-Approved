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
| Analysis | 6 | 6 | The traps you spotted: control center values, or conditions ticked, when you sent the proposal |
| Decision | 4 | 4 | The outcome your proposal leads to |
| Conditions | 4 | 2 | +1 per good condition, −1 per useless one (case 01 also gives +1 for a clean structure) |
| Committee | 6 | 8 | 0 to 2 per answer: the expected ideas, backed by numbers |

Committee answers are analysed with keywords and numbers, without AI in this version. Numbers are read in any format (`1,430`, `1.430`, `1 430`; `26m`, `26 million`, `26,000,000`; `1.20x`, `1,20x`).

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
```

`model.test.js` checks the financial formulas against reference figures. `game.test.js` checks the outcome, conditions, competition, score and gauge rules, and the analysis of committee answers.

## Project structure

```
index.html            Page skeleton: welcome, case and result screens, chat
css/style.css         All styles
js/model.js           Financial calculations only (no display, no game rules)
js/ui.js              Everything the player sees (no calculations, no rules)
js/game.js            Game rules (score, outcome, gauges, answer analysis) and game flow
cases/index.json      The list of cases shown on the welcome screen
cases/case-0X.json    Case data: documents, model inputs, conditions, questions, rules, debrief
content/case-0X.md    The same case written for humans (design document)
tests/                Tests, run with Node
```

Charts use [Chart.js](https://www.chartjs.org), loaded from a CDN. There is no framework and no build step.

## Add a new case

A case is one JSON file in `cases/`, plus one line in `cases/index.json` so it appears on the welcome screen. No code to change: copy the closest existing case (case 01 for constant assumptions, case 02 for assumptions that change over time), rename it (for example `case-03.json`), edit it, and add it to the index. Write the case in a markdown file in `content/` first; it is easier to review than JSON.

Main sections of the file:

| Key | What it holds |
| --- | --- |
| `id`, `title`, `country`, `tagline`, `level`, `readingTime` | Case header shown above the documents |
| `documents` | The tabs. Each has a `tab` name, a `title`, a `source` and a list of `blocks`. Block types: `table` (`head`, `rows`), `heading`, `paragraph`, `quote`, `list` (`items`), `message` (`from`, `text`). A tab with no blocks shows its `empty` text |
| `messages.onStart` | Chat messages that arrive while the player reads the case (`from`, `role`, `text`, `delay` in milliseconds) |
| `messages.committeeClosing` | The message that ends the committee session |
| `model.fixed` | Fixed parameters: `capacity` (and `capacityUnit`), `totalCost` (USD m), `tenor` (years, unless it is a slider), `rate` (0.07 = 7%), `minDSCR`, `warnDSCR` (amber threshold), `maxGearing`. Optional, for assumptions that change over time: `ppaYears` (after which `merchantPrice` replaces `tariff`), `merchantMinDSCR` (the bank's minimum on those years), `warrantyYears` (after which `opexAfter` replaces `opex`) |
| `model.sponsorCase` | The sponsor's value for every slider, where the control center opens, plus the `loan` requested |
| `model.inputs` | The control center sliders: `label`, `unit`, `min`, `max`, `step`. The key is the model input it sets (`yield`, `curtailment`, `tariff`, `merchantPrice`, `opex`, `opexAfter`, `tenor`). Add `"percent": true` when the value is typed in % (curtailment 10 = 10%) |
| `proposal.requestedLoan`, `proposal.loan` | Amount requested and the loan slider range |
| `proposal.decisions` | The three decisions and their hints |
| `proposal.conditions` | Each condition: `label`, `role` (`good`, `useless` or `sizing`), `points`, `burden` (weight on the sponsor), optional `gauges` effect, `reason` shown in the debrief. Optional: `rateIncrease` (0.005 = +50 bp), `redundantIfLoanAtMost` with `redundantPoints` and `redundantReason` |
| `committee` | The questions, in order. Each person (`askedBy`) gets their own conversation. `analysis` lists the expected `ideas` (each with `any`: every accepted wording), how many are needed (`minIdeas`), and the accepted `numbers` (`values`, optional `unit: "%"` and `tol`) |
| `committeeScale` | What 0, 1 and 2 points mean, shown in the result |
| `rules.outcomeChecks` | For "approve with conditions", checks tried in order; the first that fails decides the outcome, and if none fails the outcome is `right`. Types: `burden` (too heavy for the sponsor), `requireCondition` (a condition must be ticked), `maxLoan` (`max`, unless a condition in `unlessAny` is ticked), `policySizing` (the loan must fit the bank's policy on the official `bankCase`, for the tenor proposed) |
| `rules.competition` | `maxBurden` before the sponsor walks away, and the weight of a `loanCutBurden` and `tenorCutBurden` |
| `rules.score` | Traps: each has `points` and a list `any` of tests, spotted if one passes: `{ input, test: "max" or "min", value }`, `{ condition }` or `{ loanAtMost }`. Then points per decision outcome, conditions `max` and `cleanBonus`, points per committee answer |
| `outcomes` | One entry per outcome used (`right`, `weak`, `approve`, `decline`, `lost`, and any outcome named in `outcomeChecks`): `label`, `story`, `gauges` moves (one point = 10 on a 0 to 100 gauge), and `closes: true` when the deal goes ahead (the conditions' own gauge effects then apply) |
| `debrief`, `answerKey` | Shown only on the result screen. `answerKey.tables` holds the answer key's tables (`note`, `head`, `rows`, optional `footer`) |

Everything in `rules`, `outcomes`, `debrief` and `answerKey` is only displayed at the end of the game. The file itself is public once the site is online, so a curious player could read it: keep that in mind for graded sessions.

After editing a case, check that the JSON is valid (an online JSON validator works, or `python3 -m json.tool cases/case-02.json`) and play it once from start to finish.
