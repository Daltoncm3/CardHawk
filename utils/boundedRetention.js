'use strict';

function toPositiveInteger(value, fallback) {
  const number = Number(value);
  const fallbackNumber = Number(fallback);
  const normalizedFallback = Number.isFinite(fallbackNumber) && fallbackNumber > 0
    ? Math.floor(fallbackNumber)
    : 1;

  if (!Number.isFinite(number) || number <= 0) return normalizedFallback;
  return Math.floor(number);
}

function normalizeTime(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function compareOldestFirst(a = {}, b = {}, options = {}) {
  const timeKeys = Array.isArray(options.timeKeys) && options.timeKeys.length
    ? options.timeKeys
    : ['createdAt', 'timestamp', 'observedAt'];
  const idKeys = Array.isArray(options.idKeys) && options.idKeys.length
    ? options.idKeys
    : ['id'];

  const aTime = normalizeTime(timeKeys.map((key) => a[key]).find(Boolean));
  const bTime = normalizeTime(timeKeys.map((key) => b[key]).find(Boolean));
  if (aTime !== bTime) return aTime - bTime;

  const aId = String(idKeys.map((key) => a[key]).find((value) => value !== undefined && value !== null) || '');
  const bId = String(idKeys.map((key) => b[key]).find((value) => value !== undefined && value !== null) || '');
  return aId.localeCompare(bId);
}

function trimArrayToMax(items = [], maxCount = 1) {
  const safeMax = toPositiveInteger(maxCount, 1);
  if (!Array.isArray(items)) return [];
  if (items.length <= safeMax) return items.slice();
  return items.slice(items.length - safeMax);
}

function pruneMapByOldest(map, maxCount, options = {}) {
  if (!(map instanceof Map)) return [];

  const safeMax = toPositiveInteger(maxCount, 1);
  if (map.size <= safeMax) return [];

  const getEntryValue = typeof options.getEntryValue === 'function'
    ? options.getEntryValue
    : (entry) => entry[1];
  const getEntryId = typeof options.getEntryId === 'function'
    ? options.getEntryId
    : (entry) => entry[0];

  const entries = Array.from(map.entries()).map((entry) => ({
    key: entry[0],
    value: entry[1],
    sortable: {
      ...getEntryValue(entry),
      __retentionId: getEntryId(entry)
    }
  }));

  entries.sort((a, b) => compareOldestFirst(a.sortable, b.sortable, {
    timeKeys: options.timeKeys,
    idKeys: [...(options.idKeys || []), '__retentionId']
  }));

  const removeCount = map.size - safeMax;
  const removed = entries.slice(0, removeCount);
  for (const entry of removed) {
    map.delete(entry.key);
  }

  return removed.map((entry) => entry.value);
}

module.exports = {
  compareOldestFirst,
  pruneMapByOldest,
  toPositiveInteger,
  trimArrayToMax
};
