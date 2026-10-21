const { validateCuts } = require('./dist/services/cut-validator.js');
const { analyzeWithAi, setAiProvider, LocalMockAiProvider } = require('./dist/services/ai-analysis.js');

async function test() {
  const segments = Array.from({length: 100}, (_, i) => ({
    id: i,
    start: i * 8,
    end: i * 8 + 7.5,
    text: 'fala ' + i
  }));
  const options = {
    fullText: segments.map(s => s.text).join(' '),
    segments,
    videoDuration: 800,
    language: 'pt'
  };

  setAiProvider(new LocalMockAiProvider());
  const analysis = await analyzeWithAi(options);
  console.log('candidates:', analysis.cuts.length);

  const report = validateCuts(analysis.cuts, {
    videoDuration: 800,
    segments,
    maxCuts: 20,
    overlapThreshold: 0.6,
    minCutDuration: 5,
    maxCutDuration: 180
  });

  console.log('valid cuts:', report.cuts.length);
  console.log('rejected:', report.rejected.length);
  report.rejected.forEach(r => console.log('  rejected:', r.reason));
}

test().catch(e => console.error(e));
