// Curated South African governance tables (public facts with sources).
// Server only: loaded with readFileSync, validated at import, deep-frozen.
import { readFileSync } from 'node:fs';

const fail = (what) => {
  throw new Error(`invalid_governance_table: ${what}`);
};

const isObject = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

function isIsoDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function isIsoMonth(v) {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

function isHttpsUrl(v) {
  if (typeof v !== 'string') return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

const INTERVENTION_CODE = /^(?:[A-Z]{2,3}\d{3}|[A-Z]{3}|DC\d{1,2})$/;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

export function validateInterventions(value) {
  if (!isObject(value)) fail('interventions is not an object');
  if (!isIsoMonth(value.asOf)) fail('interventions asOf');
  if (!nonEmpty(value.source)) fail('interventions source');
  if (!isHttpsUrl(value.sourceUrl)) fail('interventions sourceUrl');
  if (!Array.isArray(value.rows)) fail('interventions rows');
  const seen = new Set();
  for (const row of value.rows) {
    if (!isObject(row)) fail('intervention row');
    if (typeof row.code !== 'string' || !INTERVENTION_CODE.test(row.code)) {
      fail(`intervention code ${String(row.code)}`);
    }
    if (seen.has(row.code)) fail(`duplicate code ${row.code}`);
    seen.add(row.code);
    for (const k of ['name', 'province', 'type', 'since']) {
      if (!nonEmpty(row[k])) fail(`${row.code} ${k}`);
    }
  }
  return value;
}

export function validateMetros(value) {
  if (!isObject(value)) fail('metros is not an object');
  if (!Array.isArray(value.rows)) fail('metros rows');
  const seen = new Set();
  for (const row of value.rows) {
    if (!isObject(row)) fail('metro row');
    if (!nonEmpty(row.code)) fail('metro code');
    if (seen.has(row.code)) fail(`duplicate code ${row.code}`);
    seen.add(row.code);
    if (row.status !== 'elected' && row.status !== 'unresolved') {
      fail(`${row.code} status`);
    }
    if (!nonEmpty(row.note)) fail(`${row.code} note`);
    if (!isIsoDate(row.asOf)) fail(`${row.code} asOf`);
    if (!isHttpsUrl(row.sourceUrl)) fail(`${row.code} sourceUrl`);
    if (row.status === 'elected') {
      if (!nonEmpty(row.mayor)) fail(`${row.code} mayor`);
      if (!nonEmpty(row.party)) fail(`${row.code} party`);
      if (!isIsoDate(row.electedOn)) fail(`${row.code} electedOn`);
      if (
        !Array.isArray(row.coalition) ||
        row.coalition.length === 0 ||
        !row.coalition.every(nonEmpty)
      ) {
        fail(`${row.code} coalition`);
      }
    } else if (row.mayor !== undefined) {
      fail(`${row.code} unresolved row carries a mayor`);
    }
  }
  return value;
}

const load = (name) =>
  JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));

export const INTERVENTIONS = deepFreeze(
  validateInterventions(load('interventions-2026-08.json')),
);
export const METROS = deepFreeze(validateMetros(load('metros.json')));
