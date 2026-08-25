((OWP) => {
  'use strict';

  const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

  function parseSemver(value) {
    if (typeof value !== 'string') return null;
    const match = SEMVER_RE.exec(value.trim());
    if (!match) return null;
    return {
      raw: value.trim(),
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3]),
      prerelease: match[4] ? match[4].split('.') : []
    };
  }

  function compareIdentifier(left, right) {
    const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
    const rightNumber = /^\d+$/.test(right) ? Number(right) : null;
    if (leftNumber !== null && rightNumber !== null) return Math.sign(leftNumber - rightNumber);
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return left === right ? 0 : left < right ? -1 : 1;
  }

  function compareParsed(left, right) {
    for (const key of ['major', 'minor', 'patch']) {
      if (left[key] !== right[key]) return Math.sign(left[key] - right[key]);
    }
    if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
    if (left.prerelease.length === 0) return 1;
    if (right.prerelease.length === 0) return -1;
    const length = Math.max(left.prerelease.length, right.prerelease.length);
    for (let index = 0; index < length; index += 1) {
      const l = left.prerelease[index];
      const r = right.prerelease[index];
      if (l === undefined) return -1;
      if (r === undefined) return 1;
      const compared = compareIdentifier(l, r);
      if (compared !== 0) return compared;
    }
    return 0;
  }

  function compareSemver(leftValue, rightValue) {
    const left = parseSemver(leftValue);
    const right = parseSemver(rightValue);
    if (!left || !right) return null;
    return compareParsed(left, right);
  }

  OWP.versioning = Object.freeze({ parseSemver, compareSemver });
})(globalThis.__OWP__);
