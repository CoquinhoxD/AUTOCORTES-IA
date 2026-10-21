import { alignCutToSpeech } from '../server/src/services/cut-validator.service';

describe('alinhamento dos limites de fala', () => {
  const segments = [
    { id: 0, start: 10, end: 14, text: 'O que aconteceu?' },
    { id: 1, start: 14.4, end: 21, text: 'Eu entrei na sala e vi tudo.' },
    { id: 2, start: 21.2, end: 27, text: 'Então fui embora.' },
  ];
  test('não corta começo e fim das falas', () => {
    expect(alignCutToSpeech(15, 19, segments, 180)).toEqual({start: 10, end: 21});
  });
  test('preserva pergunta imediatamente anterior', () => {
    expect(alignCutToSpeech(14.4, 20, segments, 180)).toEqual({start: 10, end: 21});
  });
  test('rejeita expansão maior que duração máxima', () => {
    expect(alignCutToSpeech(15, 19, segments, 8)).toBeNull();
  });
  test('mantém timestamps quando não há segmentos', () => {
    expect(alignCutToSpeech(5, 9, [], 180)).toEqual({start: 5, end: 9});
  });
});
