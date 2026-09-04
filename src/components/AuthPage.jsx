import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Sparkles } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";
import { Brand } from "./Brand.jsx";

export function AuthPage({ config, mode }) {
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
    <div className="auth-page">
      <section className="auth-visual">
        <video src="/media/grok-video.webm" autoPlay muted loop playsInline />
        <div className="auth-visual__shade" />
        <div className="auth-visual__top"><Brand config={config} onClick={() => navigate("/")} /></div>
        <div className="auth-quote"><Sparkles size={20} /><blockquote>“把复杂的生成链路，变成每个人都能掌控的光影语言。”</blockquote><p>一个空间，完成创意到成片。</p></div>
      </section>
      <section className="auth-form-wrap">
        <button className="auth-back" type="button" onClick={() => navigate("/")}><ArrowLeft size={17} /> 返回首页</button>
        <div className="auth-form-card">
          <span className="auth-form-card__eyebrow">WELCOME TO LIGHTFLOW</span>
          <h1>{isRegister ? "创建你的创作空间" : "欢迎回来"}</h1>
          <p>{isRegister ? "注册后即可开始生成、编排与管理作品。" : "登录后继续你的光影创作。"}</p>
          <div className="auth-tabs" role="tablist">
            <button type="button" className={!isRegister ? "active" : ""} onClick={() => navigate("/login")}>登录</button>
            <button type="button" className={isRegister ? "active" : ""} onClick={() => navigate("/register")}>注册</button>
          </div>
          <form onSubmit={submit}>
            {isRegister && <label>姓名<input value={name} onChange={(e) => setName(e.target.value)} placeholder="如何称呼你" required /></label>}
            <label>{isRegister ? "邮箱" : "账号"}<input type={isRegister ? "email" : "text"} value={email} onChange={(e) => setEmail(e.target.value)} placeholder={isRegister ? "name@company.com" : "邮箱或管理员账号"} required autoComplete={isRegister ? "email" : "username"} /></label>
            <label>密码<span className="password-field"><input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required autoComplete={isRegister ? "new-password" : "current-password"} /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label="显示或隐藏密码">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
            {isRegister && <label className="agreement"><input type="checkbox" defaultChecked required /><span><Check size={13} />同意服务条款与隐私政策</span></label>}
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="button button--primary auth-submit" type="submit" disabled={submitting}>{submitting ? "请稍候…" : (isRegister ? "创建账户" : "进入工作室")}<ArrowRight size={18} /></button>
          </form>
          <small className="demo-hint">{isRegister ? "注册成功后将自动登录并进入控制台" : "管理员账号为 admin，普通用户使用已注册邮箱登录"}</small>
        </div>
      </section>
    </div>
  );
}
