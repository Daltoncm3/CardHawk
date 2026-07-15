'use strict';

const {
  fingerprint
} = require('./canonicalValidationCore');

function buildFingerprintFromProjection(projection = {}) {
  return fingerprint(projection);
}

module.exports = {
  buildFingerprintFromProjection
};
