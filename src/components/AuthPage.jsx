import { ArrowLeft, ArrowRight, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";

export function AuthPage({ mode }) {
  const navigate = useNavigate();
  const { login, register } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isRegister = mode === "register";

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (isRegister) {
        await register({ name: name.trim(), email: email.trim(), password });
      } else {
        await login({ account: email.trim(), password });
      }
      navigate("/console", { replace: true });
    } catch (err) {
      setError(err.message || (isRegister ? "注册失败" : "登录失败"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <button className="auth-home-link" type="button" onClick={() => navigate("/")}>
        <ArrowLeft size={17} />
        返回首页
      </button>
      <div className="auth-scenery" aria-hidden="true">
        <video className="auth-video" autoPlay muted loop playsInline preload="auto" src="/assets/login/background.mp4" />
        <div className="auth-shade" />
        <img className="auth-android" src="/assets/login/android.png" alt="" />
        <div className="auth-brand-shade" />
      </div>

      <section className="auth-brand" aria-label="同道 LIGHTFLOW STUDIO">
        <div className="auth-brand-cn">同道</div>
        <div className="auth-wordmark">LIGHTFLOW STUDIO</div>
        <p>让 想 法 ， 成 为 影 像</p>
        <div className="auth-signature"><span />CREATE<br />WITH<br />AI</div>
      </section>

      <section className="auth-panel" aria-labelledby="auth-title">
        <header>
          <h1 id="auth-title">{isRegister ? "创建账户" : "欢迎回来"}</h1>
          <p>{isRegister ? "注册同道 LIGHTFLOW STUDIO，开启你的 AI 创作之旅" : "登录同道 LIGHTFLOW STUDIO，开启你的 AI 创作之旅"}</p>
        </header>

        <div className="auth-tabs" role="tablist" aria-label="登录或注册">
          <button type="button" role="tab" aria-selected={!isRegister} tabIndex={!isRegister ? 0 : -1} onClick={() => navigate("/login")}>登录</button>
          <button type="button" role="tab" aria-selected={isRegister} tabIndex={isRegister ? 0 : -1} onClick={() => navigate("/register")}>注册</button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          {isRegister && (
            <div className="auth-field">
              <label htmlFor="auth-name">姓名</label>
              <input id="auth-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="如何称呼你" maxLength={60} required />
            </div>
          )}
          <div className="auth-field">
            <label htmlFor="auth-email">{isRegister ? "邮箱" : "账号"}</label>
            <input
              id="auth-email"
              type="text"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              placeholder={isRegister ? "name@company.com" : "请输入邮箱或管理员账号"}
              required
            />
          </div>
          <div className="auth-field">
            <label htmlFor="auth-password">密码</label>
            <div className="auth-password">
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
                required
                autoComplete={isRegister ? "new-password" : "current-password"}
                placeholder={isRegister ? "设置密码（至少 6 位）" : "请输入密码"}
              />
              <button className="auth-eye" type="button" aria-label="显示或隐藏密码" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? <EyeOff size={21} /> : <Eye size={21} />}
              </button>
            </div>
          </div>
          {isRegister && (
            <label className="auth-agreement">
              <input type="checkbox" required />
              <span>同意服务条款与隐私政策</span>
            </label>
          )}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" type="submit" disabled={submitting}>
            <span>{submitting ? "正在进入…" : isRegister ? "创建账户" : "进入工作室"}</span>
            <ArrowRight size={19} />
          </button>
          <p className="auth-footnote">
            {isRegister ? "注册成功后将自动登录并进入工作室" : "管理员账号为 admin，普通用户使用已注册邮箱登录"}
          </p>
        </form>
      </section>
    </main>
  );
}
