import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, ShieldCheck, UserRound, Workflow, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { fetchEnabledModels } from "../api/models.js";
import { managedModelCatalog } from "../lib/modelCatalog.js";
import { CreditsModal } from "./CreditsModal.jsx";
import { ProfileModal } from "./ProfileModal.jsx";
import { ChevronIcon, CollapseIcon, ExpandIcon, FilmIcon, GridIcon, ImageIcon, LogoMark, ScriptIcon, ShieldIcon, SparkIcon } from "./icons/sidebarIcons.jsx";
import { FastCreate } from "./FastCreate.jsx";
import { ScriptCreation } from "./ScriptCreation.jsx";
import { MyCreations } from "./MyCreations.jsx";
import { AssetLibrary } from "./AssetLibrary.jsx";
import { AdminConsole } from "./AdminConsole.jsx";
import { DramaHome } from "./Drama/DramaHome.jsx";
import { DramaWorkbench } from "./Drama/DramaWorkbench.jsx";
import { WorkflowStudio } from "./WorkflowStudio.jsx";
import { TemplateModal } from "./TemplateModal.jsx";

const SIDEBAR_KEY = "tongdao-sidebar";

const navGroups = [
  {
    label: "创作",
    items: [
      { id: "create", to: "/console/create", label: "快速创作", Icon: SparkIcon },
      { id: "drama", to: "/console/drama", label: "短剧创作", Icon: FilmIcon },
      { id: "script", to: "/console/script", label: "剧本创作", Icon: ScriptIcon },
      { id: "studio", to: "/console/studio", label: "高级工作台", Icon: Workflow },
    ],
  },
  {
    label: "内容",
    items: [
      { id: "creations", to: "/console/creations", label: "我的创作", Icon: GridIcon },
      { id: "assets", to: "/console/assets", label: "素材库", Icon: ImageIcon },
    ],
  },
];

// 旧版侧栏基于 state 的 tab → URL 派生（保持与 React Router 协同）
function deriveActiveId(pathname) {
  if (pathname.startsWith("/console/drama")) return "drama";
  if (pathname.startsWith("/console/script")) return "script";
  if (pathname.startsWith("/console/studio")) return "studio";
  if (pathname.startsWith("/console/creations")) return "creations";
  if (pathname.startsWith("/console/assets")) return "assets";
  if (pathname.startsWith("/console/admin")) return "admin";
  return "create";
}

// 路由与具体侧栏项高亮规则一致；drama 含子路由
function navItemMatch(id, pathname) {
  if (id === "drama") return pathname === "/console/drama" || pathname.startsWith("/console/drama/");
  if (id === "admin") return pathname.startsWith("/console/admin");
  if (id === "create") return pathname === "/console" || pathname === "/console/" || pathname === "/console/create" || pathname.startsWith("/console/create/");
  if (id === "studio") return pathname === "/console/studio" || pathname.startsWith("/console/studio/");
  return pathname === `/console/${id}`;
}

export function ConsoleShell({ config, user, onLogout, onUserUpdate }) {
  const navigate = useNavigate();
  const location = useLocation();
  const dramaMatchParams = location.pathname.match(/^\/console\/drama\/([^/]+)/);
  const dramaId = dramaMatchParams ? decodeURIComponent(dramaMatchParams[1]) : null;
  const active = deriveActiveId(location.pathname);
  const isAdmin = user.isAdmin === true;
  const canSeeAdmin = isAdmin;

  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem(SIDEBAR_KEY) === "1");
  const [userMenu, setUserMenu] = useState(false);
  const [profileMode, setProfileMode] = useState(null);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateLaunch, setTemplateLaunch] = useState(null);
  const [creationReuse, setCreationReuse] = useState(null);
  const menuRef = useRef(null);

  const modelsQuery = useQuery({
    queryKey: ["public-models"],
    queryFn: fetchEnabledModels,
  });
  const models = managedModelCatalog(modelsQuery.data);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    if (dramaId) setCollapsed(true);
  }, [dramaId]);

  useEffect(() => {
    if (active === "admin" || active === "studio") setCollapsed(true);
  }, [active]);

  useEffect(() => {
    const onDocMouseDown = (event) => {
      if (!menuRef.current?.contains(event.target)) setUserMenu(false);
    };
    const onKey = (event) => { if (event.key === "Escape") setUserMenu(false); };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function toggleSidebar() { setCollapsed((current) => !current); }

  function goTab(tabId) {
    const target = tabId === "drama" && dramaId
      ? `/console/drama/${dramaId}`
      : tabId === "drama"
        ? "/console/drama"
        : `/console/${tabId}`;
    navigate(target);
  }

  function reuseCreation(seed) {
    setCreationReuse(seed);
    navigate("/console/create");
  }

  const enrichedConfig = { ...(config ?? {}), models };

  return (
    <div className={`app-shell${collapsed ? " is-collapsed" : ""}`}>
      <aside className="sidebar" aria-label="主导航">
        <div className="brand-header">
          <div className="brand-mark" aria-hidden="true"><LogoMark /></div>
          <span className="brand-name">{config?.appName ?? "同道"}</span>
          <button
            className="collapse-button"
            type="button"
            onClick={toggleSidebar}
            aria-label={collapsed ? "展开导航栏" : "折叠导航栏"}
            data-tooltip={collapsed ? "展开导航栏" : "折叠导航栏"}
          >
            {collapsed ? <ExpandIcon /> : <CollapseIcon />}
          </button>
        </div>
        <nav className="nav-scroll">
          {navGroups.map((group) => (
            <div key={group.label} className="nav-group">
              <div className="nav-label">{group.label}</div>
              {group.items.map(({ id, to, label, Icon }) => {
                const active = navItemMatch(id, location.pathname);
                return (
                  <button
                    key={id}
                    type="button"
                    className={`nav-item${active ? " active" : ""}`}
                    onClick={() => goTab(id)}
                  >
                    <Icon />
                    <span className="nav-text">{label}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {canSeeAdmin && (
            <div className="nav-group">
              <div className="nav-label">系统</div>
              <button
                type="button"
                className={`nav-item${navItemMatch("admin", location.pathname) ? " active" : ""}`}
                onClick={() => navigate("/console/admin")}
              >
                <ShieldIcon />
                <span className="nav-text">管理后台</span>
              </button>
            </div>
          )}
        </nav>
      </aside>

      <header className="topbar" role="banner">
        <div className="account-area">
          <button
            className="credit-pill"
            type="button"
            onClick={() => setCreditsOpen(true)}
            aria-label={`积分余额 ${user.credits ?? 0}，打开积分中心`}
          >
            <Zap className="credit-icon" size={14} fill="currentColor" />
            <span className="credit-value">{(user.credits ?? 0).toLocaleString("zh-CN")}</span>
            <span className="credit-unit">积分</span>
          </button>
          <div className="account-menu-wrap" ref={menuRef}>
            <button
              className="user-button"
              type="button"
              onClick={() => setUserMenu((current) => !current)}
              aria-haspopup="menu"
              aria-expanded={userMenu}
            >
              <span className="avatar">{user.name?.slice(0, 1)?.toUpperCase() ?? "·"}</span>
              <span className="user-name">{user.name}</span>
              <ChevronIcon className="user-chevron" />
            </button>
            {userMenu && (
              <div className="user-menu is-open" role="menu">
                <div className="user-summary">
                  <strong>{user.name}</strong>
                  <span>{user.email || (isAdmin ? "平台管理员" : "已登录")}</span>
                </div>
                {isAdmin && (
                  <button type="button" className="menu-action" onClick={() => { navigate("/console/admin"); setUserMenu(false); }}>
                    <ShieldCheck size={16} /> 管理后台
                  </button>
                )}
                <button type="button" className="menu-action" onClick={() => { setProfileMode("profile"); setUserMenu(false); }}>
                  <UserRound size={16} /> 个人信息
                </button>
                <div className="menu-divider" />
                <button
                  type="button"
                  className="menu-action danger"
                  onClick={() => { onLogout(); setUserMenu(false); navigate("/"); }}
                >
                  <LogOut size={16} /> 退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="main-content" role="main">
        {active === "create" && (
          <FastCreate
            config={enrichedConfig}
            modelCatalogLoading={modelsQuery.isLoading}
            modelCatalogError={modelsQuery.error}
            theme="dark"
            reuse={creationReuse}
            onReuseApplied={() => setCreationReuse(null)}
            onRequestCollapseSidebar={() => setCollapsed(true)}
            onOpenAssets={() => navigate("/console/assets")}
            credits={user?.credits ?? null}
            onNeedRecharge={() => setCreditsOpen(true)}
            onConsumeCredits={(_points, details) => {
              queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
              queryClient.invalidateQueries({ queryKey: ["credits"] });
              queryClient.invalidateQueries({ queryKey: ["creations"] });
              if (details?.refresh === false) return;
            }}
          />
        )}
        {active === "drama" && (dramaId ? <DramaWorkbench seriesId={dramaId} /> : <DramaHome />)}
        {active === "script" && <ScriptCreation />}
        {active === "studio" && (
          <WorkflowStudio
            models={models.filter((model) => model.enabled !== false)}
            onOpenTemplates={() => setTemplateOpen(true)}
            templateLaunch={templateLaunch}
          />
        )}
        {active === "creations" && <MyCreations onReuse={reuseCreation} />}
        {active === "assets" && <AssetLibrary />}
        {active === "admin" && canSeeAdmin && <AdminConsole />}
      </main>

      <TemplateModal
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        onUse={(template) => {
          setTemplateOpen(false);
          setTemplateLaunch({ ...template, token: Date.now() });
          navigate("/console/studio");
        }}
      />
      <ProfileModal
        open={Boolean(profileMode)}
        mode={profileMode}
        user={user}
        onClose={() => setProfileMode(null)}
        onSave={(next) => { onUserUpdate(next); setProfileMode(null); }}
      />
      <CreditsModal
        open={creditsOpen}
        user={user}
        recentTransactions={recentTransactions}
        onClose={() => setCreditsOpen(false)}
        onPaid={() => {
          queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
          queryClient.invalidateQueries({ queryKey: ["credits"] });
        }}
      />
    </div>
  );
}
