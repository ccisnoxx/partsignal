/** 内部账号登录页，以单一认证表单承载真实账号密码登录。 */
import { LockOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { Schema } from '../../shared/api/types';
import { api, errorMessage, setCsrfToken, unwrap } from '../../shared/api/client';
import { useAuth } from './AuthProvider';
import { LoginThemeModeControl } from './LoginThemeModeControl';

type LoginField = 'username' | 'password';

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loginValues, setLoginValues] = useState<Schema<'LoginRequest'>>({ username: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<LoginField, string>>>({});
  const [passwordVisible, setPasswordVisible] = useState(false);
  const login = useMutation({
    mutationFn: async (values: Schema<'LoginRequest'>) => unwrap(await api.POST('/api/v1/auth/login', { body: values })),
    onSuccess: async (session) => {
      setCsrfToken(session.csrf_token);
      await auth.refresh();
      const target = typeof location.state === 'object' && location.state && 'from' in location.state
        ? String(location.state.from)
        : '/';
      navigate(target, { replace: true });
    },
  });
  const updateField = (field: LoginField, value: string) => {
    setLoginValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => current[field] ? { ...current, [field]: undefined } : current);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors = new Map<LoginField, string>();
    if (!loginValues.username) errors.set('username', '请输入账号');
    if (!loginValues.password) errors.set('password', '请输入密码');
    else if (loginValues.password.length < 8) errors.set('password', '密码至少 8 位');
    setFieldErrors(Object.fromEntries(errors));
    const firstInvalid = errors.keys().next().value;
    if (firstInvalid) {
      const invalidControl = event.currentTarget.elements.namedItem(firstInvalid);
      if (invalidControl instanceof HTMLElement) invalidControl.focus();
      return;
    }
    login.mutate(loginValues);
  };

  if (auth.isAuthenticated) return <Navigate to="/" replace />;

  return (
    <main className="login-page">
      <div className="login-theme-control"><LoginThemeModeControl /></div>
      <div className="login-scene" aria-hidden="true">
        <svg className="login-flow-map" viewBox="0 0 1536 1024" preserveAspectRatio="xMidYMid slice">
          <g className="login-flow-lines">
            <path d="M-80 610C160 375 346 590 566 386" />
            <path d="M-40 730C180 560 330 810 575 620" />
            <path d="M-50 430C170 520 320 280 565 472" />
            <path d="M970 350C1110 180 1195 520 1588 285" />
            <path d="M962 505C1140 420 1200 790 1590 560" />
            <path d="M970 660C1125 860 1305 590 1590 760" />
          </g>
          <g className="login-flow-particles">
            <circle cx="82" cy="568" r="5" /><circle cx="205" cy="488" r="4" /><circle cx="346" cy="524" r="6" />
            <circle cx="1090" cy="337" r="5" /><circle cx="1232" cy="450" r="4" /><circle cx="1390" cy="368" r="6" />
            <circle cx="1108" cy="654" r="4" /><circle cx="1284" cy="680" r="6" /><circle cx="1460" cy="715" r="4" />
          </g>
          <g className="login-flow-node" transform="translate(178 292)"><circle r="30" /><path d="M-9-8h18v16H-9zm4-6h10v6H-5z" /><text x="48" y="5">内容生成</text></g>
          <g className="login-flow-node" transform="translate(280 472)"><circle r="25" /><path d="M-11 2h22M3-6l8 8-8 8M-3-6l-8 8 8 8" /><text x="43" y="5">多平台分发</text></g>
          <g className="login-flow-node" transform="translate(230 690)"><circle r="29" /><path d="M0-13v26M-13 0h26M-8-8 8 8M8-8-8 8" /><text x="48" y="5">精准触达</text></g>
          <g className="login-flow-node" transform="translate(1302 292)"><circle r="29" /><path d="M-11-8h22v16H-11zM-5 8v6M5 8v6M-6-2h1M5-2h1" /><text x="-118" y="5">GEO 观测</text></g>
          <g className="login-flow-node" transform="translate(1212 456)"><circle r="25" /><path d="M-11 4c7-10 15-10 22 0M-8-5h16M0-11v22" /><text x="-126" y="5">提及与引用</text></g>
          <g className="login-flow-node" transform="translate(1310 632)"><circle r="29" /><path d="M-12 10V-8M-4 10V0M4 10V-4M12 10V-13" /><text x="-112" y="5">效果分析</text></g>
          <g className="login-flow-node" transform="translate(1160 790)"><circle r="25" /><path d="M-12 5c7 8 17 8 24 0M-12-5c7-8 17-8 24 0M0-13v26" /><text x="43" y="5">持续优化</text></g>
        </svg>
      </div>
      <section className="login-card" aria-labelledby="login-brand-title">
        <div className="login-card-body">
          <header className="login-brand">
            <span className="login-logo" aria-hidden="true">
              <svg viewBox="0 0 48 40" focusable="false">
                <path d="M4 7h23c7 0 12 4 12 10s-5 10-12 10H16l5-8h6c2 0 3-1 3-2s-1-2-3-2H9L4 7Z" />
                <path d="M14 25h19c7 0 11 3 11 8s-4 8-11 8H4l5-8h24c1 0 2 0 2-1s-1-1-2-1H10l4-6Z" />
              </svg>
            </span>
            <h1 id="login-brand-title">PartSignal</h1>
          </header>
          <div className="login-product-copy">
            <h2>多平台 GEO 内容运营系统</h2>
            <p>让内容被看见，让价值被引用</p>
          </div>
          {login.error && <div role="alert" className="form-alert">{errorMessage(login.error)}</div>}
          <form className="login-form" aria-labelledby="login-brand-title" noValidate onSubmit={submit}>
            <div className="login-form-item">
              <label className={`login-field${fieldErrors.username ? ' has-error' : ''}`}>
                <UserOutlined aria-hidden="true" />
                <span className="visually-hidden">账号</span>
                <input
                  name="username"
                  aria-label="账号"
                  aria-invalid={!!fieldErrors.username}
                  aria-describedby={fieldErrors.username ? 'login-username-error' : undefined}
                  value={loginValues.username}
                  onChange={(event) => updateField('username', event.target.value)}
                  placeholder="请输入账号"
                  autoComplete="username"
                />
              </label>
              {fieldErrors.username && <p id="login-username-error" className="login-field-error">{fieldErrors.username}</p>}
            </div>
            <div className="login-form-item">
              <label className={`login-field${fieldErrors.password ? ' has-error' : ''}`}>
                <LockOutlined aria-hidden="true" />
                <span className="visually-hidden">密码</span>
                <input
                  name="password"
                  type={passwordVisible ? 'text' : 'password'}
                  aria-label="密码"
                  aria-invalid={!!fieldErrors.password}
                  aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
                  value={loginValues.password}
                  onChange={(event) => updateField('password', event.target.value)}
                  placeholder="请输入密码"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="login-password-toggle"
                  aria-label={passwordVisible ? '隐藏输入内容' : '显示输入内容'}
                  onClick={() => setPasswordVisible((visible) => !visible)}
                >
                  {passwordVisible ? '隐藏' : '显示'}
                </button>
              </label>
              {fieldErrors.password && <p id="login-password-error" className="login-field-error">{fieldErrors.password}</p>}
            </div>
            <button className="login-submit" type="submit" disabled={login.isPending}>
              {login.isPending ? '登录中…' : '登录'}
            </button>
          </form>
        </div>
      </section>
      <footer className="login-security-note">
        <div><SafetyCertificateOutlined /><strong>内部系统 · 操作留痕 · 全程审计 · 数据安全</strong></div>
        <p>所有操作均已记录并受审计追踪，未经授权请勿访问或使用系统资源。</p>
      </footer>
    </main>
  );
}
