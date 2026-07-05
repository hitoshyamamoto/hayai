import { describe, it, expect } from '@jest/globals';
import { DatabaseTemplates, getEngineTier } from '../../core/templates.js';

describe('DatabaseTemplates - Basic Validation', () => {
  it('should return all 30 configured databases', () => {
    const templates = DatabaseTemplates.getAllTemplates();
    expect(templates.size).toBe(30);
  });

  it('should have valid structure for all templates', () => {
    const templates = DatabaseTemplates.getAllTemplates();

    templates.forEach((template, key) => {
      // Basic structure validation
      expect(template.name).toBeTruthy();
      expect(template.engine.name).toBe(key);
      expect(template.engine.type).toBeTruthy();
      expect(template.engine.image).toBeTruthy();
      expect(template.engine.ports).toBeInstanceOf(Array);
    });
  });

  it('should include all 6 time series databases', () => {
    const timeseriesEngines = DatabaseTemplates.getEnginesByType('timeseries');
    expect(timeseriesEngines).toHaveLength(6);
    expect(timeseriesEngines).toContain('influxdb2');
    expect(timeseriesEngines).toContain('influxdb3');
    expect(timeseriesEngines).toContain('timescaledb');
  });

  it('should include all 4 key-value databases', () => {
    const keyValueEngines = DatabaseTemplates.getEnginesByType('keyvalue');
    expect(keyValueEngines).toHaveLength(4);
    expect(keyValueEngines).toContain('redis');
    expect(keyValueEngines).toContain('valkey');
    expect(keyValueEngines).toContain('leveldb');
    expect(keyValueEngines).toContain('tikv');
  });

  it('should include all 2 embedded databases', () => {
    const embeddedEngines = DatabaseTemplates.getEnginesByType('embedded');
    expect(embeddedEngines).toHaveLength(2);
    expect(embeddedEngines).toContain('sqlite');
    expect(embeddedEngines).toContain('lmdb');
  });

  it('should include all 2 analytics databases', () => {
    const analyticsEngines = DatabaseTemplates.getEnginesByType('analytics');
    expect(analyticsEngines).toHaveLength(2);
    expect(analyticsEngines).toContain('duckdb');
    expect(analyticsEngines).toContain('clickhouse');
  });

  it('should include all 2 document databases', () => {
    const documentEngines = DatabaseTemplates.getEnginesByType('document');
    expect(documentEngines).toHaveLength(2);
    expect(documentEngines).toContain('couchdb');
    expect(documentEngines).toContain('mongodb');
  });

  it('flags mongodb (and only timescaledb besides it) as not fully open source', () => {
    const info = DatabaseTemplates.getOpenSourceInfo();
    const sourceAvailable = Object.entries(info)
      .filter(([, engine]) => !engine.fullyOpenSource)
      .map(([key]) => key)
      .sort();
    expect(sourceAvailable).toEqual(['mongodb', 'timescaledb']);
  });

  it('should include 1 wide column database', () => {
    const wideColumnEngines = DatabaseTemplates.getEnginesByType('widecolumn');
    expect(wideColumnEngines).toHaveLength(1);
    expect(wideColumnEngines).toContain('cassandra');
  });

  it('assigns Tier 1 exactly to the engines the integration suite verifies', () => {
    const tier1 = [...DatabaseTemplates.getAllTemplates().keys()]
      .filter((engine) => getEngineTier(engine) === 1)
      .sort();

    // Membership is earned by CI coverage (src/tests/integration). Adding an
    // engine here without adding its end-to-end verification breaks the
    // honesty contract the tier system exists for.
    expect(tier1).toEqual([
      'duckdb',
      'leveldb',
      'lmdb',
      'mariadb',
      'mysql',
      'postgresql',
      'redis',
      'sqlite',
      'timescaledb',
      'valkey',
    ]);

    // Unknown engines never get promoted by accident
    expect(getEngineTier('not-an-engine')).toBe(2);
  });

  it('marks the cluster-only engines as experimental and nothing else', () => {
    const experimental = [...DatabaseTemplates.getAllTemplates().entries()]
      .filter(([, template]) => template.experimental)
      .map(([key]) => key)
      .sort();

    expect(experimental).toEqual(['milvus', 'nebula', 'tikv']);
  });
});
