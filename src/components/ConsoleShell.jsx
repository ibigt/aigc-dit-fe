import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Clapperboard, Images, LogOut, Moon, ShieldCheck, Sparkles, Sun, UserRound, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { rechargeCredits } from "../api/credits.js";
import { fetchEnabledModels } from "../api/models.js";
import { AssetLibrary } from "./AssetLibrary.jsx";
import { Brand } from "./Brand.jsx";
import { CreditsModal } from "./CreditsModal.jsx";
import { FastCreate } from "./FastCreate.jsx";
import { MyCreations } from "./MyCreations.jsx";
import { ProfileModal } from "./ProfileModal.jsx";
import { AdminConsole } from "./AdminConsole.jsx";

const tabs = [
  { id: "create", label: "快速创作", icon: Sparkles },
  { id: "creations", label: "我的创作", icon: Clapperboard },
  { id: "assets", label: "素材库", icon: Images },
];

export function ConsoleShell({ config, user, onLogout, onUserUpdate }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [active, setActive] = useState("create");
  const [theme, setTheme] = useState(() => window.localStorage.getItem("lightflow-console-theme") || "light");
  const [userMenu, setUserMenu] = useState(false);
  const [profileMode, setProfileMode] = useState(null);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [recentTransactions, setRecentTransactions] = useState([]);
  const modelsQuery = useQuery({
    queryKey: ["public-models"],
    queryFn: fetchEnabledModels,
  });
  const models = modelsQuery.data?.length ? modelsQuery.data : config.models;
  const menuRef = useRef(null);
  const isAdmin = user.isAdmin === true;
  const visibleTabs = isAdmin ? [...tabs, { id: "admin", label: "管理后台", icon: ShieldCheck }] : tabs;

  useEffect(() => {
    const close = (event) => { if (!menuRef.current?.contains(event.target)) setUserMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  useEffect(() => { window.localStorage.setItem("lightflow-console-theme", theme); }, [theme]);

  return (
    <div className="console-shell" data-theme={theme}>
      <header className="console-header">
        <Brand config={config} compact onClick={() => navigate("/")} />
        <nav aria-label="控制台主导航">{visibleTabs.map((tab) => {
          const Icon = tab.icon;
          return <button key={tab.id} type="button" className={active === tab.id ? "active" : ""} onClick={() => setActive(tab.id)}><Icon size={16} />{tab.label}</button>;
        })}</nav>
        <div className="console-account">
          <button className="theme-toggle" type="button" aria-label={`切换到${theme === "light" ? "夜间" : "日间"}模式`} title={`当前为${theme === "light" ? "日间" : "夜间"}模式`} onClick={() => setTheme((current) => current === "light" ? "dark" : "light")}>{theme === "light" ? <Sun size={14} /> : <Moon size={14} />}<span>{theme === "light" ? "日间" : "夜间"}</span></button>
          <button className="credit-pill" type="button" onClick={() => setCreditsOpen(true)} aria-label={`积分余额 ${user.credits}，打开积分中心`}><Zap size={14} fill="currentColor" /> {user.credits}<span>积分</span></button>
          <div className="account-menu-wrap" ref={menuRef}>
            <button className="account-trigger" type="button" onClick={() => setUserMenu(!userMenu)}>
              <span className="avatar">{user.name.slice(0, 1)}</span>
              <span><strong>{user.name}</strong><small>{isAdmin ? "平台管理员" : "已登录"}</small></span>
              <ChevronDown size={15} />
            </button>
            {userMenu && <div className="account-dropdown">
              <header><span className="avatar avatar--large">{user.name.slice(0, 1)}</span><div><strong>{user.name}</strong><small>{user.email}</small></div></header>
              {isAdmin && <button type="button" onClick={() => { setActive("admin"); setUserMenu(false); }}><ShieldCheck size={16} /> 管理后台</button>}
              <button type="button" onClick={() => { setProfileMode("profile"); setUserMenu(false); }}><UserRound size={16} /> 个人信息</button>
              <div />
              <button type="button" className="danger" onClick={() => { onLogout(); navigate("/"); }}><LogOut size={16} /> 退出登录</button>
            </div>}
          </div>
        </div>
      </header>
      <main className="console-content">
        {active === "create" && <FastCreate config={{ ...config, models }} theme={theme} onOpenAssets={() => setActive("assets")} onConsumeCredits={(_points, details) => {
          queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
          queryClient.invalidateQueries({ queryKey: ["credits"] });
          queryClient.invalidateQueries({ queryKey: ["creations"] });
          if (details?.refresh === false) return;
        }} />}
        {active === "creations" && <MyCreations />}
        {active === "assets" && <AssetLibrary />}
        {active === "admin" && isAdmin && <AdminConsole />}
      </main>
      <ProfileModal open={Boolean(profileMode)} mode={profileMode} user={user} onClose={() => setProfileMode(null)} onSave={(next) => { onUserUpdate(next); setProfileMode(null); }} />
      <CreditsModal open={creditsOpen} user={user} recentTransactions={recentTransactions} onClose={() => setCreditsOpen(false)} onRecharge={async (amountYuan, payment) => {
        const profile = await rechargeCredits({ amountYuan, payment });
        onUserUpdate(profile);
        queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
        queryClient.invalidateQueries({ queryKey: ["credits"] });
      }} />
    </div>
  );
}
