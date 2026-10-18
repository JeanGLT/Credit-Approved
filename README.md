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

### Score (out of 20)

| Part | Points | What counts |
| --- | --- | --- |
| Analysis | 6 | The traps you fixed in the control center when you sent the proposal |
| Decision | 4 | The outcome your proposal leads to |
| Conditions | 4 | +1 per good condition, −1 per useless one, +1 for a clean structure |
| Committee | 6 | 0 to 2 per answer: the expected ideas, backed by numbers |

Committee answers are analysed with keywords and numbers, without AI in this version. Numbers are read in any format (`1,430`, `1.430`, `1 430`; `26m`, `26 million`, `26,000,000`; `1.20x`, `1,20x`).

## Play it on your computer

The game loads its case from a JSON file, which browsers refuse to do when you double-click `index.html`. Start a small local server from the project folder (Python comes with macOS):

```
python3 -m http.server 8000
```

Then open http://localhost:8000 in your browser. Stop the server with Ctrl+C.

To open another case, add its name to the address: http://localhost:8000/?case=case-02 loads `cases/case-02.json`. Without it, the first case opens.

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
cases/case-01.json    Case data: documents, model inputs, conditions, questions, rules, debrief
content/case-01.md    The same case written for humans (design document)
tests/                Tests, run with Node
```

Charts use [Chart.js](https://www.chartjs.org), loaded from a CDN. There is no framework and no build step.

## Add a new case

A case is one JSON file in `cases/`. No code to change: copy `cases/case-01.json`, rename it (for example `case-02.json`), edit it, and open the game with `?case=case-02`. Write the case in a markdown file in `content/` first; it is easier to review than JSON.

Main sections of the file:

| Key | What it holds |
| --- | --- |
| `id`, `title`, `country`, `tagline`, `level`, `readingTime` | Case header shown above the documents |
| `documents` | The tabs. Each has a `tab` name, a `title`, a `source` and a list of `blocks`. Block types: `table` (`head`, `rows`), `heading`, `paragraph`, `quote`, `list` (`items`), `message` (`from`, `text`). A tab with no blocks shows its `empty` text |
| `messages.onStart` | Chat messages that arrive while the player reads the case (`from`, `role`, `text`, `delay` in milliseconds) |
| `messages.committeeClosing` | The message that ends the committee session |
| `model.fixed` | Fixed parameters: `capacity` (MWp), `totalCost` (USD m), `tenor` (years), `rate` (0.07 = 7%), `minDSCR`, `warnDSCR` (amber threshold), `maxGearing` |
| `model.sponsorCase` | The sponsor's assumptions, where the control center opens. `curtailment` is in % (10 = 10%) |
| `model.inputs` | Label, unit, `min`, `max` and `step` of each slider |
| `proposal.requestedLoan`, `proposal.loan` | Amount requested and the loan slider range |
| `proposal.decisions` | The three decisions and their hints |
| `proposal.conditions` | Each condition: `label`, `role` (`good`, `useless` or `sizing`), `points`, `burden` (weight on the sponsor), optional `gauges` effect, `reason` shown in the debrief. Optional: `rateIncrease` (0.005 = +50 bp), `redundantIfLoanAtMost` with `redundantPoints` and `redundantReason` |
| `committee` | The questions, in order. Each person (`askedBy`) gets their own conversation. `analysis` lists the expected `ideas` (each with `any`: every accepted wording), how many are needed (`minIdeas`), and the accepted `numbers` (`values`, optional `unit: "%"` and `tol`) |
| `committeeScale` | What 0, 1 and 2 points mean, shown in the result |
| `rules.rightConditions` | When "approve with conditions" fixes the sizing: loan at most `maxLoan`, or any condition in `orAnyCondition` |
| `rules.competition` | `maxBurden` before the sponsor walks away, and the weight of a `loanCutBurden` |
| `rules.score` | Trap tests (`input`, `test`: `max` or `min`, `value`, `points`), points per decision outcome, conditions max and clean bonus, points per committee answer |
| `outcomes` | For each outcome (`right`, `weak`, `approve`, `decline`, `lost`): `label`, `story` and `gauges` moves (one point = 10 on a 0 to 100 gauge) |
| `debrief`, `answerKey` | Shown only on the result screen |

Everything in `rules`, `outcomes`, `debrief` and `answerKey` is only displayed at the end of the game. The file itself is public once the site is online, so a curious player could read it: keep that in mind for graded sessions.

After editing a case, check that the JSON is valid (an online JSON validator works, or `python3 -m json.tool cases/case-02.json`) and play it once from start to finish.
