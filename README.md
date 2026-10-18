# Credit-Approved

A web game where you play a junior credit analyst in project finance and decide whether to lend.

Work in progress.

## Run it on your computer

The game loads its case from a JSON file, which browsers refuse to do when you
double-click `index.html`. Start a small local server from the project folder:

```
python3 -m http.server 8000
```

Then open http://localhost:8000 in your browser. Stop the server with Ctrl+C.

## Run the tests

```
node tests/model.test.js
node tests/game.test.js
```

`model.test.js` checks the financial formulas, `game.test.js` the outcome, score and gauge rules.
