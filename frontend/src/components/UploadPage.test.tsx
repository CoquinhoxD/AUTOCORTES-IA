import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { UploadPage } from './UploadPage';

const mockUpload = jest.fn();
const mockGetHealth = jest.fn().mockResolvedValue({ status: 'ok', maxVideoSizeMb: 5120 });

jest.mock('../services/api', () => ({
  api: {
    upload: (...args: unknown[]) => mockUpload(...args),
    getHealth: (...args: unknown[]) => mockGetHealth(...args),
  },
  ApiError: class extends Error {},
}));

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

function createVideoFile(name = 'meu-video.mp4', sizeBytes = 1024): File {
  const file = new File([new ArrayBuffer(1)], name, { type: 'video/mp4' });
  Object.defineProperty(file, 'size', { value: sizeBytes, configurable: true });
  return file;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetHealth.mockResolvedValue({ status: 'ok', maxVideoSizeMb: 5120 });
});

describe('UploadPage', () => {
  it('renderiza o título e subtítulo', () => {
    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <UploadPage />
      </BrowserRouter>
    );

    expect(
      screen.getByRole('heading', { name: /Encontre os melhores cortes do seu vídeo/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Envie um vídeo e deixe a IA encontrar os momentos/i)
    ).toBeInTheDocument();
  });

  it('mostra o botão SELECIONAR VÍDEO quando não há arquivo', () => {
    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <UploadPage />
      </BrowserRouter>
    );

    expect(screen.getByRole('button', { name: 'SELECIONAR VÍDEO' })).toBeInTheDocument();
    expect(screen.getByText(/Arraste e solte seu vídeo aqui/)).toBeInTheDocument();
  });

  it('mantém ANALISAR VÍDEO desabilitado sem arquivo selecionado', () => {
    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <UploadPage />
      </BrowserRouter>
    );

    expect(screen.getByRole('button', { name: 'ANALISAR VÍDEO' })).toBeDisabled();
  });

  it('mostra o nome e tamanho do arquivo após seleção', () => {
    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <UploadPage />
      </BrowserRouter>
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [createVideoFile('podcast.mp4', 5 * 1024 * 1024)],
      configurable: true,
    });

    input.dispatchEvent(new Event('change', { bubbles: true }));

    waitFor(() => {
      expect(screen.getByText('podcast.mp4')).toBeInTheDocument();
    });
  });

  it('exibe erro ao selecionar formato não suportado', async () => {
    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <UploadPage />
      </BrowserRouter>
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [createVideoFile('video.avi', 1024)],
      configurable: true,
    });

    input.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Formato não suportado/i);
    });
    expect(screen.getByRole('button', { name: 'ANALISAR VÍDEO' })).toBeDisabled();
  });

  it('exibe erro quando o arquivo excede o limite do backend', async () => {
    mockGetHealth.mockResolvedValue({ status: 'ok', maxVideoSizeMb: 100 });

    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <UploadPage />
      </BrowserRouter>
    );

    // Aguarda o health check descobrir o limite
    await waitFor(() => expect(mockGetHealth).toHaveBeenCalled());

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [createVideoFile('grande.mp4', 200 * 1024 * 1024)],
      configurable: true,
    });

    input.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/excede o limite/i);
    });
  });

  it('envia o arquivo e navega para a análise', async () => {
    mockUpload.mockResolvedValue({ videoId: 'abc-123', status: 'QUEUED' });

    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <UploadPage />
      </BrowserRouter>
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = createVideoFile('ok.mp4');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const submitButton = screen.getByRole('button', { name: 'ANALISAR VÍDEO' });

    await waitFor(() => expect(submitButton).toBeEnabled());

    submitButton.click();

    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalledWith(file);
      expect(mockNavigate).toHaveBeenCalledWith('/analysis/abc-123');
    });
  });

  it('mostra erro quando o upload falha', async () => {
    mockUpload.mockRejectedValue(new Error('Arquivo excede o limite'));

    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <UploadPage />
      </BrowserRouter>
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [createVideoFile('ok.mp4')],
      configurable: true,
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const submitButton = screen.getByRole('button', { name: 'ANALISAR VÍDEO' });
    await waitFor(() => expect(submitButton).toBeEnabled());
    submitButton.click();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Arquivo excede o limite');
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('mostra os formatos aceitos', () => {
    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <UploadPage />
      </BrowserRouter>
    );

    const hint = screen.getByText(/\.mp4 · \.mov · \.webm · \.mkv/);
    expect(hint).toBeInTheDocument();
  });
});
