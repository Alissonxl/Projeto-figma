import { bench, describe } from 'vitest';
import { AnalysisBudget } from '../src/plugin/analysisBudget';

function boundedScan(total: number): number {
  const budget = new AnalysisBudget();
  let analyzed = 0;
  for (let index = 0; index < total; index++) {
    if (!budget.tryNode()) break;
    analyzed++;
  }
  budget.registerSkipped(total - analyzed);
  return analyzed;
}

describe('contador isolado do budget global', () => {
  for (const total of [1_000, 10_000, 50_000])
    bench(`${total} candidatos`, () => {
      boundedScan(total);
    });
});
