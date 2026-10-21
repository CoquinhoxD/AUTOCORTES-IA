import { render, screen, waitFor, act } from '@testing-library/react';
import { VideoClipPlayer } from './VideoClipPlayer';

describe('VideoClipPlayer', () => {
  const defaultProps = {
    videoUrl: '/api/videos/teste/stream',
    startTime: 10,
    endTime: 45,
  };

  it('renderiza o player com os tempos corretos', () => {
    render(<VideoClipPlayer {...defaultProps} />);

    expect(screen.getByText('Início')).toBeInTheDocument();
    expect(screen.getByText('00:10')).toBeInTheDocument();
    expect(screen.getByText('Fim')).toBeInTheDocument();
    expect(screen.getByText('00:45')).toBeInTheDocument();
    expect(screen.getByText('Duração')).toBeInTheDocument();
    expect(screen.getByText('00:35')).toBeInTheDocument();
  });

  it('renderiza o botão REPRODUZIR CORTE', () => {
    render(<VideoClipPlayer {...defaultProps} />);
    // Há dois botões: o overlay central (aria-label) e o botão de controle abaixo.
    expect(screen.getByRole('button', { name: 'Reproduzir corte' })).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /REPRODUZIR CORTE/i }).length
    ).toBeGreaterThan(0);
  });

  it('renderiza controles de navegação', () => {
    render(<VideoClipPlayer {...defaultProps} />);

    expect(screen.getByRole('button', { name: '−5s' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+5s' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'REINICIAR' })).toBeInTheDocument();
  });

  it('oculta o painel de informações quando showInfo é false', () => {
    render(<VideoClipPlayer {...defaultProps} showInfo={false} />);

    expect(screen.queryByText('Início')).not.toBeInTheDocument();
    expect(screen.queryByText('Duração')).not.toBeInTheDocument();
  });

  it('usa o elemento <video> com a URL correta', () => {
    const { container } = render(<VideoClipPlayer {...defaultProps} />);
    const video = container.querySelector('video');

    expect(video).toBeTruthy();
    expect(video).toHaveAttribute('src', defaultProps.videoUrl);
    expect(video).toHaveAttribute('preload', 'metadata');
  });

  it('define o startTime no elemento de vídeo quando os metadados carregam', async () => {
    const { container } = render(<VideoClipPlayer {...defaultProps} />);
    const video = container.querySelector('video') as HTMLVideoElement;

    Object.defineProperty(video, 'currentTime', {
      writable: true,
      value: 0,
    });

    await act(async () => {
      video.dispatchEvent(new Event('loadedmetadata'));
    });

    await waitFor(() => {
      expect(video.currentTime).toBe(10);
    });
  });

  it('pausa a reprodução ao atingir o endTime', async () => {
    const pauseSpy = jest.spyOn(HTMLMediaElement.prototype, 'pause');

    const { container } = render(<VideoClipPlayer {...defaultProps} />);
    const video = container.querySelector('video') as HTMLVideoElement;

    Object.defineProperty(video, 'currentTime', {
      writable: true,
      value: 45,
    });

    await act(async () => {
      video.dispatchEvent(new Event('timeupdate'));
    });

    expect(pauseSpy).toHaveBeenCalled();
  });

  it('calcula a duração do clip corretamente', () => {
    render(<VideoClipPlayer {...defaultProps} />);
    // 45 - 10 = 35 segundos
    expect(screen.getByText('00:35')).toBeInTheDocument();
  });

  it('funciona com clip de duração zero', () => {
    render(<VideoClipPlayer videoUrl="/test.mp4" startTime={10} endTime={10} />);
    expect(screen.getByText('00:00')).toBeInTheDocument();
  });

  it('salta e pausa ao receber um novo seekRequest', async () => {
    const { container, rerender } = render(
      <VideoClipPlayer {...defaultProps} seekRequest={{ time: 30, id: 1 }} />
    );

    const video = container.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'currentTime', { writable: true, value: 0 });

    const pauseSpy = jest.spyOn(video, 'pause');
    Object.defineProperty(video, 'paused', { writable: true, value: true });

    rerender(
      <VideoClipPlayer {...defaultProps} seekRequest={{ time: 30, id: 2 }} />
    );

    await waitFor(() => {
      expect(video.currentTime).toBe(30);
    });
    expect(pauseSpy).toHaveBeenCalled();
  });

  it('ignora seekRequest com o mesmo id', async () => {
    const { container, rerender } = render(
      <VideoClipPlayer {...defaultProps} seekRequest={{ time: 20, id: 1 }} />
    );

    const video = container.querySelector('video') as HTMLVideoElement;
    // jsdom não mantém currentTime; fixa um valor conhecido após o mount.
    Object.defineProperty(video, 'currentTime', { writable: true, value: 20 });

    // Mesmo id, tempo diferente: não deve reposicionar o vídeo
    rerender(
      <VideoClipPlayer {...defaultProps} seekRequest={{ time: 40, id: 1 }} />
    );
    await new Promise((r) => setTimeout(r, 50));

    expect(video.currentTime).toBe(20);
  });

  it('notifica o tempo atual durante a reprodução', async () => {
    const onTimeUpdate = jest.fn();
    const { container } = render(
      <VideoClipPlayer {...defaultProps} onTimeUpdate={onTimeUpdate} />
    );

    const video = container.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'currentTime', { writable: true, value: 25 });

    await act(async () => {
      video.dispatchEvent(new Event('timeupdate'));
    });

    expect(onTimeUpdate).toHaveBeenCalledWith(25);
  });
});
