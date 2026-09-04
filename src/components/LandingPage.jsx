import { ArrowRight, ChevronDown, CircleGauge, Film, Images, Layers3, LogOut, Play, Sparkles, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Brand } from "./Brand.jsx";
import { ProfileModal } from "./ProfileModal.jsx";

export function LandingPage({ config, user, onLogout, onUserUpdate }) {
  const navigate = useNavigate();
  const showcase = config.media.slice(1, 5);
  const [userMenu, setUserMenu] = useState(false);
  const [profileMode, setProfileMode] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    const close = (event) => { if (!menuRef.current?.contains(event.target)) setUserMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className="landing-page">
      <header className="landing-nav shell-width">
        <Brand config={config} showSubtitle={false} onClick={() => navigate("/")} />
        <nav aria-label="首页导航">
          <a href="#capabilities">能力</a>
          <a href="#showcase">灵感</a>
          <a href="#workflow">创作</a>
        </nav>
        <div className="landing-actions">
          {user ? (
            <div className="account-menu-wrap" ref={menuRef}>
              <button className="nav-user" aria-label="个人信息" aria-expanded={userMenu} onClick={() => setUserMenu(!userMenu)}>
                <span>{user.name.slice(0, 1)}</span>{user.name}<ChevronDown size={15} />
              </button>
              {userMenu && <div className="account-dropdown landing-account-dropdown">
                <header><span className="avatar avatar--large">{user.name.slice(0, 1)}</span><div><strong>{user.name}</strong><small>{user.email}</small></div></header>
                <button type="button" onClick={() => navigate("/console")}><CircleGauge size={16} /> 进入控制台</button>
                <button type="button" onClick={() => { setProfileMode("profile"); setUserMenu(false); }}><UserRound size={16} /> 个人信息</button>
                <div />
                <button type="button" className="danger" onClick={() => { setUserMenu(false); onLogout(); }}><LogOut size={16} /> 退出登录</button>
              </div>}
            </div>
          ) : (
            <>
              <button className="button button--ghost" type="button" onClick={() => navigate("/login")}>登录</button>
              <button className="button button--dark" type="button" onClick={() => navigate("/register")}>免费开始</button>
            </>
          )}
        </div>
      </header>

      <main>
        <section className="hero shell-width">
          <div className="hero__copy">
            <h1>让每一束灵感<br /><em>抵达银幕。</em></h1>
            <p>{config.description}。从一句想法到完整镜头，在同一个空间里生成与沉淀。</p>
            <div className="hero__actions">
              <button className="button button--primary button--large" type="button" onClick={() => navigate(user ? "/console" : "/register")}>
                开始创作 <ArrowRight size={18} />
              </button>
              <button className="button button--soft button--large" type="button" onClick={() => document.querySelector("#showcase")?.scrollIntoView({ behavior: "smooth" })}>
                <Play size={17} fill="currentColor" /> 查看作品
              </button>
            </div>
            <div className="hero__trust">
              <span>支持模型</span>
              {config.models.filter((model) => model.enabled !== false).slice(0, 4).map((model) => <strong key={model.id}>{model.name}</strong>)}
            </div>
          </div>
          <div className="hero__visual" aria-label="AI 影像示例">
            <div className="hero-video-wrap">
              <video src={config.media[0].src} poster={config.media[0].poster} autoPlay muted loop playsInline />
              <div className="hero-video-label"><span className="status-dot" /> 实时生成 <small>00:08</small></div>
            </div>
            <div className="floating-card floating-card--top"><Sparkles size={16} /><span><b>光影增强</b><small>正在实时计算</small></span></div>
            <div className="floating-card floating-card--bottom"><Film size={16} /><span><b>多模型生成</b><small>图与视频随时切换</small></span></div>
          </div>
        </section>

        <section className="metric-strip shell-width" id="capabilities">
          <div><strong>{config.models.filter((model) => model.enabled !== false).length}+</strong><span>已接入生成模型</span></div>
          <div><strong>4K</strong><span>最高输出规格</span></div>
          <div><strong>1–4</strong><span>一次可出多份副本</span></div>
          <div><strong>1</strong><span>统一素材空间</span></div>
        </section>

        <section className="showcase shell-width" id="showcase">
          <div className="section-heading">
            <div><h2>灵感，不必等待。</h2></div>
            <p>真实生成片段，本地加载。悬停即可预览每一个瞬间。</p>
          </div>
          <div className="showcase-grid">
            {showcase.map((item, index) => (
              <article className={`showcase-card showcase-card--${index + 1}`} key={item.id}>
                <video src={item.src} poster={item.poster} autoPlay muted loop playsInline />
                <div className="showcase-card__shade" />
                <div className="showcase-card__meta"><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{item.title}</h3><p>{item.model}</p></div><Play size={18} fill="currentColor" /></div>
              </article>
            ))}
          </div>
        </section>

        <section className="workflow-story" id="workflow">
          <div className="workflow-story__inner shell-width">
            <div className="section-heading section-heading--light">
              <div><h2>创作，不止于生成。</h2></div>
              <p>把提示词、参考素材与成片放进同一空间，灵感可以随时被再次唤起。</p>
            </div>
            <div className="capability-cards">
              <article><span><Film size={22} /></span><h3>快速创作</h3><p>自然语言驱动的图/视频生成，参考素材与首尾帧随时切换。</p></article>
              <article><span><Images size={22} /></span><h3>素材沉淀</h3><p>统一管理图片与视频，创作时用 @ 即可引用。</p></article>
              <article><span><Layers3 size={22} /></span><h3>积分与副本</h3><p>按模型售价、参数与副本实时计价，成片可回看下载。</p></article>
            </div>
            <button className="button button--light button--large" type="button" onClick={() => navigate(user ? "/console" : "/register")}>进入光驭工作室 <ArrowRight size={18} /></button>
          </div>
        </section>
      </main>

      <footer className="landing-footer shell-width">
        <Brand config={config} showSubtitle={false} />
        <p>让技术隐于幕后，让创意站在光里。</p>
        <span>© 2026 {config.appName}</span>
      </footer>
      {user && <ProfileModal open={Boolean(profileMode)} mode={profileMode} user={user} onClose={() => setProfileMode(null)} onSave={(next) => { onUserUpdate(next); setProfileMode(null); }} />}
    </div>
  );
}
