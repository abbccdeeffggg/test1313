import type { User } from 'firebase/auth';

interface TopBarProps {
  user: User | null;
  authReady: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
}

export function TopBar({ user, authReady, onSignIn, onSignOut }: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-element Brand Wordmark */}
        <a
          href="#my-devices"
          className="text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          AA+
        </a>

        {/* Zone 2: Concise single-line navigation links */}
        <nav
          aria-label="주요 섹션 이동"
          className="hidden sm:flex items-center gap-7 text-sm font-medium text-slate-600"
        >
          <a
            href="#my-devices"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            내 제품
          </a>
          <a
            href="#register-device"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            제품 등록
          </a>
          <a
            href="#dashboard"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            대시보드
          </a>
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center shrink-0">
          {!authReady ? (
            <span className="text-xs text-slate-400 whitespace-nowrap">연결 중...</span>
          ) : user ? (
            <button
              type="button"
              onClick={onSignOut}
              title={`${user.email || user.displayName || '계정'} 로그아웃`}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {(user.displayName || user.email?.split('@')[0] || '내 계정').slice(0, 12)} · 로그아웃
            </button>
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Google 로그인
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
