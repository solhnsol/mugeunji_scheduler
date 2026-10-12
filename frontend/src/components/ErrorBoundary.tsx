import { Component, ReactNode } from 'react';

/** 화면 하나의 렌더링 오류가 앱 전체를 빈 화면으로 만들지 않게 막고, 새로고침 경로를 준다 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="min-h-dvh flex items-center justify-center p-6 bg-cream">
        <div className="card max-w-sm w-full p-6 text-center space-y-4" role="alert">
          <h1 className="font-semibold text-ink">화면을 불러오지 못했어요</h1>
          <p className="text-sm text-ink-muted">잠시 후 다시 시도해 주세요. 계속되면 단톡방으로 알려주세요.</p>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => (window.location.href = '/')}>
              홈으로
            </button>
            <button type="button" className="btn-primary flex-1" onClick={() => window.location.reload()}>
              새로고침
            </button>
          </div>
        </div>
      </div>
    );
  }
}
