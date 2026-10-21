import '@testing-library/jest-dom';

// jsdom lança "not implemented" para play/pause/load de <video>.
// Substitui por stubs para que o componente possa ser testado.
HTMLMediaElement.prototype.play = jest.fn().mockResolvedValue(undefined);
HTMLMediaElement.prototype.pause = jest.fn();
HTMLMediaElement.prototype.load = jest.fn();

// readyState começa em 0 (HAVE_NOTHING), como no jsdom, para que os
// componentes registrem listeners de 'loadedmetadata' normalmente.
Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
  configurable: true,
  get: () => 0,
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }),
});
