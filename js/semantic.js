/*
 * Sentence similarity with a small open-source model that runs in the
 * player's browser (Transformers.js + all-MiniLM-L6-v2). No game rules here:
 * this file only turns sentences into vectors and compares them.
 * Nothing the player writes leaves the browser; only the library and the
 * model weights are downloaded (from jsdelivr and huggingface.co).
 *
 * In Node (tests/semantic.eval.js), pass the library to load():
 *   Semantic.load({ lib: await import('@huggingface/transformers') })
 */
(function (root) {
  'use strict';

  var LIB_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';
  var MODEL = 'Xenova/all-MiniLM-L6-v2';
  var LOAD_TIMEOUT = 60000;

  var extractorPromise = null;
  var status = 'idle'; // idle → loading → ready | failed
  var cache = new Map(); // sentence → vector, so each sentence is embedded once

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('Model load timed out')); }, ms);
      promise.then(
        function (v) { clearTimeout(timer); resolve(v); },
        function (e) { clearTimeout(timer); reject(e); }
      );
    });
  }

  // Starts loading once; later calls return the same promise.
  function load(options) {
    options = options || {};
    if (extractorPromise) return extractorPromise;
    status = 'loading';
    var libPromise = options.lib ? Promise.resolve(options.lib) : import(LIB_URL);
    extractorPromise = withTimeout(libPromise.then(function (lib) {
      lib.env.allowLocalModels = false;
      lib.env.useBrowserCache = typeof caches !== 'undefined';
      return lib.pipeline('feature-extraction', MODEL, { dtype: 'q8' });
    }), options.timeout || LOAD_TIMEOUT).then(
      function (extractor) { status = 'ready'; return extractor; },
      function (err) { status = 'failed'; throw err; }
    );
    return extractorPromise;
  }

  // One normalised vector (array of 384 numbers) per sentence.
  function embed(sentences) {
    return load().then(function (extractor) {
      var missing = sentences.filter(function (s) { return !cache.has(s); });
      if (!missing.length) return null;
      return extractor(missing, { pooling: 'mean', normalize: true }).then(function (tensor) {
        tensor.tolist().forEach(function (vector, i) { cache.set(missing[i], vector); });
      });
    }).then(function () {
      return sentences.map(function (s) { return cache.get(s); });
    });
  }

  // Vectors are normalised, so the cosine similarity is the dot product.
  function similarity(a, b) {
    var sum = 0;
    for (var i = 0; i < a.length; i++) sum += a[i] * b[i];
    return sum;
  }

  // Splits on . ! ? followed by a space, and on line breaks,
  // so "1.30x" or "USD 26.3m" stay whole.
  function splitSentences(text) {
    return String(text || '')
      .split(/(?<=[.!?])\s+|\n+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  var Semantic = {
    MODEL: MODEL,
    load: load,
    embed: embed,
    similarity: similarity,
    splitSentences: splitSentences,
    status: function () { return status; }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Semantic;
  } else {
    root.Semantic = Semantic;
  }
})(typeof window !== 'undefined' ? window : this);
