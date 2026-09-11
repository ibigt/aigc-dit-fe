import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Ban,
  Bot,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CloudCog,
  Cpu,
  Gauge,
  Globe,
  Grid2X2,
  KeyRound,
  LayoutDashboard,
  List,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  changeAdminModelEnabled,
  changeAdminUserStatus,
  createAdminModel,
  createAdminUser,
  deleteAdminModel,
  deleteAdminUser,
  fetchAdminModels,
  fetchAdminUsers,
  fetchDashboard,
  resetAdminUserPassword,
  testAdminModelConnection,
  updateAdminModel,
  updateAdminUser,
} from "../api/admin.js";

const adminMenus = [
  { id: "dashboard", label: "仪表盘", icon: LayoutDashboard },
  { id: "users", label: "用户管理", icon: Users },
  { id: "models", label: "模型管理", icon: Bot },
];

const categoryLabels = { image: "图像模型", video: "视频模型", text: "文本模型" };
const categoryTabs = [{ id: "all", label: "全部" }, { id: "video", label: "视频模型" }, { id: "image", label: "图像模型" }, { id: "text", label: "文本模型" }];
const providerOptions = ["全部来源", "ComfyUI", "RunningHub", "官方API", "自定义配置"];
const usageColors = ["#665cf1", "#33a474", "#e2943b", "#d76588", "#8b94a1"];

const MODE_CAP_OPTIONS = [
  { id: "t2i", kind: "image", label: "t2i 文生图", pathKey: "t2iPath", pathLabel: "文生图路径 / URL", placeholder: "rhart-image-g-2/text-to-image", defaultPath: "rhart-image-g-2/text-to-image" },
  { id: "i2i", kind: "image", label: "i2i 参考生图", pathKey: "i2iPath", pathLabel: "参考生图路径 / URL", placeholder: "厂商参考生图路径" },
  { id: "t2v", kind: "video", label: "t2v 文生视频", pathKey: "t2vPath", pathLabel: "文生视频路径 / URL", placeholder: "rhart-video/sparkvideo-2.0/text-to-video", defaultPath: "rhart-video/sparkvideo-2.0/text-to-video" },
  { id: "r2v", kind: "video", label: "r2v 参考生视频", pathKey: "r2vPath", pathLabel: "参考生视频路径 / URL", placeholder: "rhart-video/sparkvideo-2.0/multimodal-video", defaultPath: "rhart-video/sparkvideo-2.0/multimodal-video" },
  { id: "i2v", kind: "video", label: "i2v 首尾帧", pathKey: "i2vPath", pathLabel: "首尾帧路径 / URL", placeholder: "厂商首尾帧路径" },
];

const ADAPTER_OPTIONS = [
  { key: "gpt-image-2", label: "GPT Image 2", category: "image", provider: "RunningHub", defaultEndpoint: "https://www.runninghub.ai", modes: ["t2i"], defaultPaths: { t2iPath: "rhart-image-g-2/text-to-image" } },
  { key: "agnes-image-2.5", label: "Agnes Image 2.5", category: "image", provider: "官方API", defaultEndpoint: "https://api.agnes-ai.cn/v1", modes: ["t2i", "i2i"], defaultPaths: {}, defaultModelKey: "agnes-image-2.5-flash" },
  { key: "seedance-2", label: "Seedance 2.x", category: "video", provider: "RunningHub", defaultEndpoint: "https://www.runninghub.ai", modes: ["t2v", "r2v"], defaultPaths: { t2vPath: "rhart-video/sparkvideo-2.0/text-to-video", r2vPath: "rhart-video/sparkvideo-2.0/multimodal-video" } },
  { key: "minimax-h3", label: "MiniMax-H3", category: "video", provider: "ComfyUI", defaultEndpoint: "http://127.0.0.1:8188", modes: ["t2v", "r2v", "i2v"], defaultPaths: {} },
  { key: "agnes-video-2.5", label: "Agnes Video 2.5", category: "video", provider: "官方API", defaultEndpoint: "https://api.agnes-ai.cn/v1", modes: ["t2v", "r2v", "i2v"], defaultPaths: {}, defaultModelKey: "agnes-video-2.5-flash" },
  { key: "agnes-text", label: "Agnes 对话", category: "text", provider: "官方API", defaultEndpoint: "https://api.agnes-ai.cn/v1", modes: [], defaultPaths: {}, defaultModelKey: "agnes-2.5-flash" },
  { key: "openai-compat", label: "OpenAI 兼容", category: "text", provider: "自定义配置", defaultEndpoint: "", modes: [], defaultPaths: {}, defaultModelKey: "" },
];

function adaptersForCategory(category) {
  return ADAPTER_OPTIONS.filter((item) => item.category === category);
}

function adapterOf(key) {
  return ADAPTER_OPTIONS.find((item) => item.key === key);
}

function defaultAdapterKey(category) {
  return adaptersForCategory(category)[0]?.key || "";
}

function inferAdapterKey(model) {
  if (model?.adapterKey && adapterOf(model.adapterKey)) return model.adapterKey;
  const provider = String(model?.provider || "").toLowerCase();
  const key = String(model?.modelKey || "").toLowerCase();
  const category = model?.category;
  if (category === "text") {
    if (provider.includes("自定义") || provider.includes("手动") || provider.includes("openai") || key.includes("openai") || key.includes("gpt-4") || key.includes("gpt-3")) return "openai-compat";
    return "agnes-text";
  }
  if (key.includes("agnes-image") || ((provider.includes("官方") || provider.includes("agnes")) && category === "image")) return "agnes-image-2.5";
  if (key.includes("agnes") || ((provider.includes("官方") || provider.includes("agnes")) && category === "video")) return "agnes-video-2.5";
  if (key.includes("minimax") || (provider.includes("comfy") && category === "video")) return "minimax-h3";
  if (key.includes("seedance") || (provider.includes("running") && category === "video")) return "seedance-2";
  if (key.includes("gpt-image") || (provider.includes("running") && category === "image")) return "gpt-image-2";
  return defaultAdapterKey(category);
}

const MODEL_LOGO_CATALOG = [
  { file: "/model-logos/agnes.svg", label: "Agnes AI", keys: ["agnes"] },
  { file: "/model-logos/deepseek.svg", label: "DeepSeek", keys: ["deepseek", "深度求索"] },
  { file: "/model-logos/openai.svg", label: "OpenAI / GPT", keys: ["gpt-image", "gpt", "openai", "dall-e", "dalle", "sora"] },
  { file: "/model-logos/bytedance-color.svg", label: "字节 / Seedance", keys: ["seedance", "seedream", "bytedance"] },
  { file: "/model-logos/doubao-color.svg", label: "豆包", keys: ["doubao", "豆包"] },
  { file: "/model-logos/midjourney.svg", label: "Midjourney / Niji", keys: ["midjourney", "niji"] },
  { file: "/model-logos/qwen-color.svg", label: "通义千问", keys: ["qwen", "tongyi", "千问"] },
  { file: "/model-logos/kling-color.svg", label: "可灵", keys: ["kling", "可灵"] },
  { file: "/model-logos/alibabacloud-color.svg", label: "阿里 / 万相", keys: ["wan2", "wan-", "万相", "alibaba", "aliyun"] },
  { file: "/model-logos/minimax-color.svg", label: "MiniMax", keys: ["minimax"] },
  { file: "/model-logos/hailuo-color.svg", label: "海螺", keys: ["hailuo", "海螺"] },
  { file: "/model-logos/runway.svg", label: "Runway", keys: ["runway", "aleph"] },
  { file: "/model-logos/google-color.svg", label: "Google", keys: ["google", "gemini", "imagen", "veo", "omni"] },
  { file: "/model-logos/lightricks.svg", label: "Lightricks / LTX", keys: ["ltx", "lightricks"] },
  { file: "/model-logos/nanobanana-color.svg", label: "Banana", keys: ["banana"] },
  { file: "/model-logos/elevenlabs.svg", label: "ElevenLabs", keys: ["eleven"] },
  { file: "/model-logos/comfyui-color.svg", label: "ComfyUI", keys: ["comfy"] },
];
const FALLBACK_LOGO = "/model-logos/comfyui-color.svg";

function matchModelLogo(name, modelKey, provider) {
  const haystack = `${name || ""} ${modelKey || ""} ${provider || ""}`.toLowerCase();
  let best = null;
  let bestLen = 0;
  for (const item of MODEL_LOGO_CATALOG) {
    for (const key of item.keys) {
      if (haystack.includes(key.toLowerCase()) && key.length > bestLen) {
        best = item.file;
        bestLen = key.length;
      }
    }
  }
  if (best) return best;
  return FALLBACK_LOGO;
}

function modelLogoSrc(model) {
  const stored = model?.logo;
  const matched = matchModelLogo(model?.name, model?.modelKey, model?.provider);
  if (!stored || stored === FALLBACK_LOGO) return matched;
  if (stored === "/model-logos/openai.svg" && (matched === "/model-logos/agnes.svg" || matched === "/model-logos/deepseek.svg")) {
    return matched;
  }
  return stored;
}

function endpointLabel(provider) {
  if (provider === "ComfyUI") return "ComfyUI 服务地址";
  if (provider === "官方API") return "官方 API 地址";
  if (provider === "自定义配置" || provider === "手动配置") return "Base URL";
  return "RunningHub API 地址";
}

function categoryBadge(category) {
  if (category === "video") return "视频";
  if (category === "text") return "文本";
  return "图像";
}

function matchesProviderFilter(modelProvider, filter) {
  if (filter === "全部来源") return true;
  if (filter === "自定义配置") return modelProvider === "自定义配置" || modelProvider === "手动配置";
  return modelProvider === filter;
}

function pathPlaceholder(cap, adapterKey) {
  const adapter = adapterOf(adapterKey);
  if (adapter?.provider === "官方API") return "官方 API 无需填写路径";
  if (adapter?.key === "minimax-h3") return "可留空（MiniMax-H3 使用内置工作流）";
  if (adapter?.provider === "RunningHub") return cap.placeholder;
  return "接口路径或完整 URL";
}

function pathValue(draft, pathKey) {
  const direct = draft?.[pathKey] || draft?.adapterConfig?.[pathKey] || "";
  if (direct) return direct;
  if (pathKey === "i2vPath") return draft?.v2vPath || draft?.adapterConfig?.v2vPath || "";
  return "";
}

function capsForAdapter(category, adapterKey) {
  const allowed = new Set(adapterOf(adapterKey)?.modes || []);
  return MODE_CAP_OPTIONS.filter((item) => item.kind === category && allowed.has(item.id));
}

function filterCapsForAdapter(caps, category, adapterKey) {
  const allowed = new Set(capsForAdapter(category, adapterKey).map((item) => item.id));
  const next = [];
  for (const item of canonicalizeCaps(caps)) {
    if (item === category || allowed.has(item)) {
      if (!next.includes(item)) next.push(item);
    }
  }
  if (!next.includes(category)) next.unshift(category);
  const hasMode = next.some((item) => allowed.has(item));
  if (!hasMode) {
    for (const mode of allowed) next.push(mode);
  }
  return next;
}

function canonicalizeCap(cap) {
  if (cap === "frames" || cap === "frame" || cap === "v2v") return "i2v";
  return cap;
}

function canonicalizeCaps(caps) {
  const seen = [];
  for (const item of caps || []) {
    const next = canonicalizeCap(item);
    if (!seen.includes(next)) seen.push(next);
  }
  return seen;
}

function formatInt(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function formatChange(percent) {
  if (percent == null) return "较昨日 —";
  const sign = percent > 0 ? "+" : "";
  return `较昨日 ${sign}${Number(percent).toFixed(1)}%`;
}

function formatLastSeen(iso) {
  if (!iso) return "尚未活跃";
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (Number.isNaN(diff)) return "尚未活跃";
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return date.toLocaleString("zh-CN", { hour12: false }).replaceAll("/", "-");
}

function errorMessage(error, fallback) {
  return error?.message || fallback;
}

function SectionHeading({ title, description, action }) {
  return <header className="admin-page-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}

function MetricCard({ icon: Icon, label, value, change, tone }) {
  return <article className={`admin-metric admin-metric--${tone}`}><span><Icon size={19} /></span><div><small>{label}</small><strong>{value}</strong><em>{change}</em></div></article>;
}

function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-dashboard", 14],
    queryFn: () => fetchDashboard(14),
  });
  const metrics = data?.metrics || {};
  const trend = data?.trend || [];
  const hours = data?.hourly || Array.from({ length: 24 }, () => 0);
  const usages = (data?.modelUsage || []).map((item, index) => ({
    ...item,
    color: usageColors[index % usageColors.length],
  }));
  const sources = data?.sources || [];
  const maxTrend = Math.max(1, ...trend.map((item) => item.count || 0));
  const maxHour = Math.max(1, ...hours);
  const peakHour = data?.peakHour;
  return <div className="admin-page">
    <SectionHeading title="仪表盘" description="查看平台运行、模型调用与用户活跃情况。" action={<button className="admin-date"><Clock3 size={15} /> 最近 {data?.periodDays || 14} 天</button>} />
    {error && <div className="admin-notice">{errorMessage(error, "仪表盘加载失败")}</div>}
    <div className="admin-metrics">
      <MetricCard icon={Activity} label="今日请求" value={isLoading ? "…" : formatInt(metrics.todayRequests)} change={formatChange(metrics.todayRequestsChange)} tone="violet" />
      <MetricCard icon={Users} label="活跃用户" value={isLoading ? "…" : formatInt(metrics.activeUsers)} change={`本周新增 ${formatInt(metrics.newUsersThisWeek)}`} tone="green" />
      <MetricCard icon={Bot} label="启用模型" value={isLoading ? "…" : formatInt(metrics.enabledModels)} change={`共 ${formatInt(metrics.totalModels)} 个模型`} tone="blue" />
      <MetricCard icon={CircleDollarSign} label="今日积分消耗" value={isLoading ? "…" : formatInt(metrics.todayCreditCost)} change="按任务 credit_cost 汇总" tone="amber" />
      <MetricCard icon={Gauge} label="请求成功率" value={isLoading ? "…" : `${Number(metrics.successRate || 0).toFixed(1)}%`} change={`平均响应 ${Number(metrics.avgDurationSeconds || 0).toFixed(1)}s`} tone="rose" />
    </div>
    <div className="admin-dashboard-grid">
      <article className="admin-card admin-card--trend">
        <header><div><strong>请求趋势</strong><small>近 {data?.periodDays || 14} 天模型调用量</small></div><span>总计 {formatInt(trend.reduce((sum, item) => sum + (item.count || 0), 0))} 次</span></header>
        <div className="trend-chart" role="img" aria-label="请求趋势图">{trend.map((item, index) => <div key={item.date || index}><i style={{ height: `${Math.round((item.count || 0) / maxTrend * 100)}%` }} /><span>{index % 2 ? "" : `${String(item.date || "").slice(8)}日`}</span></div>)}</div>
      </article>
      <article className="admin-card">
        <header><div><strong>模型使用分析</strong><small>按请求次数占比</small></div><MoreHorizontal size={17} /></header>
        <div className="analysis-list">{usages.length ? usages.map((item) => <div key={item.name}><span><i style={{ background: item.color }} />{item.name}</span><b>{item.percent}%</b><em><i style={{ width: `${item.percent * 2.8}%`, background: item.color }} /></em></div>) : <div className="admin-empty"><span>暂无任务数据</span></div>}</div>
      </article>
      <article className="admin-card">
        <header><div><strong>请求来源分析</strong><small>创作入口调用分布</small></div><ChevronRight size={17} /></header>
        <div className="source-list">{sources.length ? sources.map((item) => <div key={item.name}><span>{item.name}</span><b>{item.percent}%</b><em><i style={{ width: `${item.percent}%` }} /></em></div>) : <div className="admin-empty"><span>暂无任务数据</span></div>}</div>
      </article>
      <article className="admin-card admin-card--hours">
        <header><div><strong>时段分析</strong><small>24 小时请求密度</small></div><span className="peak-badge">{peakHour == null ? "暂无峰值" : `峰值 ${String(peakHour).padStart(2, "0")}:00`}</span></header>
        <div className="hour-chart" role="img" aria-label="二十四小时请求时段分析">{hours.map((value, index) => <div key={index} title={`${index}:00 · ${value} 次`}><i style={{ height: `${Math.max(8, Math.round(value / maxHour * 100))}%` }} /><span>{index % 3 === 0 ? `${String(index).padStart(2, "0")}:00` : ""}</span></div>)}</div>
      </article>
    </div>
  </div>;
}

function UserDialog({ user, onClose, onSave, saving }) {
  const [draft, setDraft] = useState(user || { name: "", account: "", role: "CREATOR", credits: 100, status: "ENABLED" });
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="model-dialog user-dialog" role="dialog" aria-modal="true" aria-labelledby="user-dialog-title">
      <header><div><span>账号资料</span><h2 id="user-dialog-title">{user ? "编辑用户" : "添加用户"}</h2><p>维护账号、角色、状态和积分余额。</p></div><button className="modal-close" aria-label="关闭用户表单" onClick={onClose}><X size={18} /></button></header>
      <form onSubmit={(event) => { event.preventDefault(); onSave({ ...draft, credits: Number(draft.credits) || 0 }); }}>
        <div className="model-form-grid">
          <label>姓名<input required value={draft.name || ""} onChange={(event) => update("name", event.target.value)} /></label>
          <label>登录账号<input required value={draft.account || ""} onChange={(event) => update("account", event.target.value)} placeholder="name@example.com" disabled={Boolean(user)} /></label>
          <label>角色<select value={draft.role || "CREATOR"} onChange={(event) => update("role", event.target.value)}><option value="ADMIN">平台管理员</option><option value="CREATOR">创作者</option></select></label>
          <label>账号状态<select value={draft.status || "ENABLED"} onChange={(event) => update("status", event.target.value)}><option value="ENABLED">正常</option><option value="DISABLED">已禁用</option></select></label>
          <label>积分余额<input type="number" min="0" value={draft.credits ?? 0} onChange={(event) => update("credits", event.target.value)} /></label>
          {!user && <label>初始密码<input type="password" value={draft.password || ""} onChange={(event) => update("password", event.target.value)} placeholder="留空则自动生成" /></label>}
        </div>
        <footer>
          <span><ShieldCheck size={14} /> 变更将写入服务端</span>
          <div>
            <button type="button" onClick={onClose}>取消</button>
            <button className="button button--primary" type="submit" disabled={saving}><Check size={15} /> {saving ? "保存中…" : "保存用户"}</button>
          </div>
        </footer>
      </form>
    </section>
  </div>;
}

function UsersPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(undefined);
  const [notice, setNotice] = useState("");
  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => fetchAdminUsers({ pageSize: 100 }),
  });
  const users = usersQuery.data?.result || [];
  const visible = users.filter((user) => `${user.name}${user.account}${user.email || ""}`.toLowerCase().includes(query.toLowerCase()));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
  };

  const saveMutation = useMutation({
    mutationFn: (draft) => {
      const payload = {
        name: draft.name,
        account: draft.account,
        email: draft.account,
        role: draft.role,
        status: draft.status,
        creditBalance: Number(draft.credits) || 0,
        password: draft.password || undefined,
      };
      return draft.id ? updateAdminUser(draft.id, payload) : createAdminUser(payload);
    },
    onSuccess: (resp) => {
      invalidate();
      setEditing(undefined);
      const extra = resp?.temporaryPassword ? `，临时密码：${resp.temporaryPassword}` : "";
      setNotice(`已保存 ${resp?.name || "用户"} 的账号资料${extra}`);
    },
    onError: (error) => setNotice(errorMessage(error, "保存用户失败")),
  });

  const statusMutation = useMutation({
    mutationFn: (user) => changeAdminUserStatus(user.id, user.status === "ENABLED" ? "DISABLED" : "ENABLED"),
    onSuccess: (resp) => {
      invalidate();
      setNotice(`${resp.name} 已${resp.status === "ENABLED" ? "启用" : "禁用"}`);
    },
    onError: (error) => setNotice(errorMessage(error, "更新状态失败")),
  });

  const resetMutation = useMutation({
    mutationFn: (user) => resetAdminUserPassword(user.id).then((resp) => ({ user, resp })),
    onSuccess: ({ user, resp }) => setNotice(`${user.name} 的密码已重置，临时密码：${resp.temporaryPassword}`),
    onError: (error) => setNotice(errorMessage(error, "重置密码失败")),
  });

  const deleteMutation = useMutation({
    mutationFn: (user) => deleteAdminUser(user.id).then(() => user),
    onSuccess: (user) => {
      invalidate();
      setNotice(`已删除用户 ${user.name}`);
    },
    onError: (error) => setNotice(errorMessage(error, "删除用户失败")),
  });

  return <div className="admin-page">
    <SectionHeading title="用户管理" description="支持账号新增、编辑、查询、删除、启停与密码重置。" action={<button className="button button--primary" onClick={() => setEditing(null)}><Plus size={16} /> 添加用户</button>} />
    {notice && <div className="admin-notice"><Check size={15} />{notice}<button aria-label="关闭提示" onClick={() => setNotice("")}><X size={14} /></button></div>}
    {usersQuery.error && <div className="admin-notice">{errorMessage(usersQuery.error, "用户列表加载失败")}</div>}
    <div className="admin-table-card">
      <div className="admin-table-toolbar">
        <label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名或账号" /></label>
        <div><span>共 {visible.length} 位用户</span></div>
      </div>
      <div className="admin-table-scroll">
        <table>
          <thead><tr><th>用户</th><th>角色</th><th>积分余额</th><th>请求数</th><th>最后活跃</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>{visible.map((user) => <tr key={user.id}>
            <td><span className="table-avatar">{(user.name || "?").slice(0, 1)}</span><span><strong>{user.name}</strong><small>{user.account}</small></span></td>
            <td>{user.roleLabel || user.role}</td>
            <td>{formatInt(user.credits)}</td>
            <td>{formatInt(user.requests)}</td>
            <td>{formatLastSeen(user.lastSeen)}</td>
            <td><span className={`status-chip ${user.status === "ENABLED" ? "active" : ""}`}>{user.statusLabel || (user.status === "ENABLED" ? "正常" : "已禁用")}</span></td>
            <td>
              <div className="table-actions">
                <button title="编辑" aria-label={`编辑用户：${user.name}`} onClick={() => setEditing(user)}><Pencil size={14} /></button>
                <button title="重置密码" aria-label={`重置密码：${user.name}`} onClick={() => resetMutation.mutate(user)}><KeyRound size={14} /></button>
                <button title={user.status === "ENABLED" ? "禁用" : "启用"} aria-label={`${user.status === "ENABLED" ? "禁用" : "启用"}用户：${user.name}`} onClick={() => statusMutation.mutate(user)}>{user.status === "ENABLED" ? <Ban size={14} /> : <Play size={14} />}</button>
                <button className="danger" title="删除" aria-label={`删除用户：${user.name}`} onClick={() => { if (window.confirm(`确定删除用户“${user.name}”吗？`)) deleteMutation.mutate(user); }}><Trash2 size={14} /></button>
              </div>
            </td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>
    {editing !== undefined && <UserDialog user={editing} saving={saveMutation.isPending} onClose={() => setEditing(undefined)} onSave={(draft) => saveMutation.mutate(draft)} />}
  </div>;
}

function PriceEditor({ title, values, onChange }) {
  return <fieldset className="price-editor"><legend>{title}</legend>{["input", "output", "cache"].map((key) => <label key={key}>{key === "input" ? "输入" : key === "output" ? "输出" : "缓存命中"}<input value={values?.[key] || "0"} onChange={(event) => onChange(key, event.target.value)} /></label>)}</fieldset>;
}

function ModelDialog({ model, onClose, onSave, saving }) {
  const emptyPricing = { unit: "张", sale: { input: "0", output: "3 积分", cache: "0" }, cost: { input: "0", output: "¥0.20", cache: "0" } };
  const [testHint, setTestHint] = useState({ ok: false, text: "" });
  const [testing, setTesting] = useState(false);
  const [draft, setDraft] = useState(() => {
    if (!model) {
      const adapterKey = defaultAdapterKey("image");
      const adapter = adapterOf(adapterKey);
      return { name: "", category: "image", adapterKey, provider: adapter.provider, modelKey: "", endpoint: adapter.defaultEndpoint, description: "", enabled: true, apiKey: "", concurrentLimit: 1, instanceType: "", proxy: "", pricing: emptyPricing, logo: FALLBACK_LOGO, capabilities: ["image", ...adapter.modes], adapterConfig: {}, t2iPath: adapter.defaultPaths.t2iPath || "", i2iPath: "", t2vPath: "", r2vPath: "", i2vPath: "" };
    }
    const adapterKey = inferAdapterKey(model);
    return {
      ...model,
      adapterKey,
      provider: adapterOf(adapterKey)?.provider || model.provider,
      capabilities: filterCapsForAdapter(model.capabilities, model.category || "image", adapterKey),
      t2iPath: pathValue(model, "t2iPath"),
      i2iPath: pathValue(model, "i2iPath"),
      t2vPath: pathValue(model, "t2vPath"),
      r2vPath: pathValue(model, "r2vPath"),
      i2vPath: pathValue(model, "i2vPath"),
      logo: modelLogoSrc(model),
    };
  });
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const updateIdentity = (patch) => setDraft((current) => {
    const next = { ...current, ...patch };
    const auto = matchModelLogo(next.name, next.modelKey, next.provider);
    const prevAuto = matchModelLogo(current.name, current.modelKey, current.provider);
    if (!current.logo || current.logo === prevAuto || current.logo === FALLBACK_LOGO) {
      next.logo = auto;
    }
    return next;
  });
  const applyAdapter = (current, adapterKey, category = current.category) => {
    const adapter = adapterOf(adapterKey);
    if (!adapter) return current;
    const prevDefault = adapterOf(current.adapterKey)?.defaultEndpoint;
    const next = {
      ...current,
      category,
      adapterKey: adapter.key,
      provider: adapter.provider,
      capabilities: filterCapsForAdapter(current.capabilities, category, adapter.key),
    };
    if (!current.endpoint || current.endpoint === prevDefault) {
      next.endpoint = adapter.defaultEndpoint;
    }
    const prevModelKey = adapterOf(current.adapterKey)?.defaultModelKey;
    if (!current.modelKey || current.modelKey === prevModelKey) {
      next.modelKey = adapter.defaultModelKey || "";
    }
    for (const [pathKey, path] of Object.entries(adapter.defaultPaths || {})) {
      if (!pathValue(next, pathKey)) next[pathKey] = path;
    }
    const auto = matchModelLogo(next.name, next.modelKey, next.provider);
    const prevAuto = matchModelLogo(current.name, current.modelKey, current.provider);
    if (!current.logo || current.logo === prevAuto || current.logo === FALLBACK_LOGO) next.logo = auto;
    return next;
  };
  const changeAdapter = (adapterKey) => setDraft((current) => applyAdapter(current, adapterKey));
  const changeCategory = (category) => setDraft((current) => applyAdapter(current, defaultAdapterKey(category), category));
  const toggleCap = (cap) => setDraft((current) => {
    const allowed = capsForAdapter(current.category, current.adapterKey).some((item) => item.id === cap);
    if (!allowed) return current;
    const caps = filterCapsForAdapter(current.capabilities, current.category, current.adapterKey);
    const enable = !caps.includes(cap);
    const next = { ...current, capabilities: enable ? [...caps, cap] : caps.filter((item) => item !== cap) };
    if (enable && current.provider === "RunningHub") {
      const field = MODE_CAP_OPTIONS.find((item) => item.id === cap);
      const adapterPath = adapterOf(current.adapterKey)?.defaultPaths?.[field?.pathKey];
      if ((adapterPath || field?.defaultPath) && !pathValue(current, field.pathKey)) {
        next[field.pathKey] = adapterPath || field.defaultPath;
      }
    }
    return next;
  });
  const visibleCapOptions = capsForAdapter(draft.category, draft.adapterKey);
  const caps = filterCapsForAdapter(draft.capabilities, draft.category, draft.adapterKey);
  const updatePrice = (side, key, value) => setDraft((current) => ({ ...current, pricing: { ...(current.pricing || emptyPricing), [side]: { ...(current.pricing?.[side] || emptyPricing[side]), [key]: value } } }));
  const adapter = adapterOf(draft.adapterKey);
  const isText = draft.category === "text";
  const providerCopy = adapter?.provider === "ComfyUI"
    ? "适配协议决定字段翻译；来源 ComfyUI 与默认服务地址已自动带出。"
    : adapter?.provider === "自定义配置"
      ? "文本通道走 OpenAI 兼容 /v1/chat/completions。请填写 Base URL 与模型标识；本地网关无鉴权时可留空 API Key。"
      : adapter?.provider === "官方API"
        ? (isText
          ? "文本通道走官方对话接口。默认地址与 Agnes 图/视频相同，模型标识填 agnes-2.5-flash。"
          : "适配协议决定字段翻译；来源「官方API」与 Agnes 默认地址已自动带出。请填写官方 API Key，模型标识使用官方 model ID。")
        : "适配协议决定字段翻译；来源 RunningHub 与默认 API 地址已自动带出。";
  async function onTestConnection() {
    setTesting(true);
    setTestHint({ ok: false, text: "" });
    try {
      const resp = await testAdminModelConnection({
        id: model?.id,
        endpoint: draft.endpoint,
        apiKey: draft.apiKey,
        modelKey: draft.modelKey,
        adapterKey: draft.adapterKey,
      });
      setTestHint({ ok: true, text: resp?.message || "连接成功" });
    } catch (error) {
      setTestHint({ ok: false, text: errorMessage(error, "连接失败") });
    } finally {
      setTesting(false);
    }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="model-dialog model-dialog--wide" role="dialog" aria-modal="true" aria-labelledby="model-dialog-title">
      <header><div><span>模型接入</span><h2 id="model-dialog-title">{model ? "编辑模型" : "接入第三方模型"}</h2><p>{providerCopy}</p></div><button className="modal-close" aria-label="关闭配置" onClick={onClose}><X size={18} /></button></header>
      <form onSubmit={(event) => {
        event.preventDefault();
        onSave({
          ...draft,
          capabilities: isText ? ["text"] : filterCapsForAdapter(draft.capabilities, draft.category, draft.adapterKey),
          badge: categoryLabels[draft.category] ? categoryBadge(draft.category) : draft.badge,
          category: draft.category,
          enabled: draft.enabled !== false,
          pricing: draft.pricing || emptyPricing,
        });
      }}>
        <div className="model-form-grid">
          <label>名称<input required value={draft.name} onChange={(event) => updateIdentity({ name: event.target.value })} placeholder={isText ? "例如：Agnes 对话" : "例如：自有视频模型"} /></label>
          <label>模型类型<select value={draft.category} onChange={(event) => changeCategory(event.target.value)}><option value="image">图像模型</option><option value="video">视频模型</option><option value="text">文本模型</option></select></label>
          <label>适配协议<select required value={draft.adapterKey} onChange={(event) => changeAdapter(event.target.value)}>{adaptersForCategory(draft.category).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
          <label>接入来源<input value={draft.provider || ""} readOnly /></label>
          <label>模型标识<input required value={draft.modelKey} onChange={(event) => updateIdentity({ modelKey: event.target.value })} placeholder={adapter?.key === "openai-compat" ? "如 deepseek-v3-flash" : (adapter?.defaultModelKey || (isText ? "对话模型名，如 gpt-4o-mini" : "商品标识，如 seedance-2.0"))} /></label>
          <label className="model-form-wide">{endpointLabel(draft.provider)}<input required value={draft.endpoint || ""} onChange={(event) => update("endpoint", event.target.value)} placeholder={draft.provider === "自定义配置" ? "https://api.openai.com/v1 或兼容网关" : ""} />{draft.provider === "官方API" && <small className="model-logo-hint">{isText ? "默认 https://api.agnes-ai.cn/v1。对话标识填 agnes-2.5-flash。" : "默认 https://api.agnes-ai.cn/v1。图片标识填 agnes-image-2.5-flash，视频填 agnes-video-2.5-flash。"}</small>}</label>
          <label className="model-form-wide">API Key<input type="password" value={draft.apiKey || ""} onChange={(event) => update("apiKey", event.target.value)} placeholder={draft.hasApiKey ? "已加密保存，留空则保持不变" : (adapter?.provider === "自定义配置" ? "可留空（本地网关无鉴权）" : "明文仅提交一次，服务端加密落库")} /></label>
          <div className="model-form-wide model-cap-field"><span>品牌图标</span><div className="model-logo-picker">{MODEL_LOGO_CATALOG.map((item) => <button type="button" key={item.file} className={draft.logo === item.file ? "active" : ""} title={item.label} aria-label={item.label} onClick={() => update("logo", item.file)}><img src={item.file} alt="" /></button>)}</div><small className="model-logo-hint">按名称 / 标识自动匹配，也可手动点选。未命中时使用通用图标。</small></div>
          {!isText && <div className="model-form-wide model-cap-field"><span>能力勾选</span><div className="model-cap-row">{visibleCapOptions.map((cap) => <label key={cap.id} className="model-cap-chip"><input type="checkbox" checked={caps.includes(cap.id)} onChange={() => toggleCap(cap.id)} />{cap.label}</label>)}</div></div>}
          {!isText && draft.provider !== "官方API" && visibleCapOptions.filter((cap) => caps.includes(cap.id)).map((cap) => (
            <label key={cap.pathKey} className="model-form-wide">{cap.pathLabel}<input value={pathValue(draft, cap.pathKey)} onChange={(event) => update(cap.pathKey, event.target.value)} placeholder={pathPlaceholder(cap, draft.adapterKey)} /></label>
          ))}
          {!isText && draft.provider === "RunningHub" && <><label>实例类型<input value={draft.instanceType || ""} onChange={(event) => update("instanceType", event.target.value)} placeholder="可选，如 48G" /></label><label>并发限制<input type="number" min="1" max="10" value={draft.concurrentLimit || 1} onChange={(event) => update("concurrentLimit", Number(event.target.value))} /></label></>}
          <label className="model-form-wide">能力说明<input value={draft.description || ""} onChange={(event) => update("description", event.target.value)} placeholder="简要说明适用场景" /></label>
          <label>计费单位<select value={draft.pricing?.unit || "次"} onChange={(event) => setDraft((current) => ({ ...current, pricing: { ...(current.pricing || emptyPricing), unit: event.target.value } }))}><option>次</option><option>张</option><option>秒</option><option>万字符</option></select></label>
          <div />
          <PriceEditor title="售价" values={draft.pricing?.sale || emptyPricing.sale} onChange={(key, value) => updatePrice("sale", key, value)} />
          <PriceEditor title="成本" values={draft.pricing?.cost || emptyPricing.cost} onChange={(key, value) => updatePrice("cost", key, value)} />
        </div>
        <footer>
          {isText ? (
            <div className="model-dialog-test">
              <button type="button" disabled={testing} onClick={onTestConnection}>{testing ? "测试中…" : "测试连接"}</button>
              {testHint.text && <small className={testHint.ok ? "model-dialog-test__ok" : "model-dialog-test__err"}>{testHint.text}</small>}
            </div>
          ) : (
            <span><ShieldCheck size={14} /> 密钥加密落库，不会回传到列表</span>
          )}
          <div>
            <button type="button" onClick={onClose}>取消</button>
            <button className="button button--primary" type="submit" disabled={saving}><Check size={15} /> {saving ? "保存中…" : "保存配置"}</button>
          </div>
        </footer>
      </form>
    </section>
  </div>;
}

function PriceCell({ title, pricing, side }) {
  const values = pricing?.[side] || {};
  return <div className={`price-cell price-cell--${side}`}><strong>{title} · {values.output || "0"}/{pricing?.unit || "次"}</strong><small>输入 {values.input || "0"} · 缓存 {values.cache || "0"}</small></div>;
}

function ModelCard({ model, onToggle, onEdit, onRemove }) {
  return <article className="model-card"><header><span className="model-logo"><img src={modelLogoSrc(model)} alt="" /></span><div><strong>{model.name}</strong><small>{model.modelKey}</small></div><label className="toggle-switch"><input aria-label={`${model.name} 创作端可用`} type="checkbox" checked={model.enabled !== false} onChange={(event) => onToggle(event.target.checked)} /><span /></label></header><p>{model.description}</p><div className="model-card-meta"><span>{categoryLabels[model.category] || model.category}</span><span>{model.provider}</span><span><i />{model.hasApiKey ? "密钥已配置" : "未配置密钥"}</span></div><div className="model-card-pricing"><PriceCell title="售价" pricing={model.pricing} side="sale" /><PriceCell title="成本" pricing={model.pricing} side="cost" /></div><footer><span>{model.category === "text" ? "用于漫剧文本" : "同步至创作端"}</span><div><button aria-label={`编辑模型：${model.name}`} onClick={onEdit}><Pencil size={14} /> 编辑</button><button className="danger" aria-label={`删除模型：${model.name}`} onClick={onRemove}><Trash2 size={14} /></button></div></footer></article>;
}

function toModelPayload(draft) {
  const category = draft.category;
  const adapterKey = draft.adapterKey;
  const caps = filterCapsForAdapter(draft.capabilities, category, adapterKey);
  const adapter = adapterOf(adapterKey);
  const adapterConfig = MODE_CAP_OPTIONS.reduce((config, field) => {
    if (!caps.includes(field.id)) return config;
    const fallback = adapter?.provider === "RunningHub" ? (adapter.defaultPaths?.[field.pathKey] || field.defaultPath || "") : "";
    const value = (draft[field.pathKey] || config[field.pathKey] || fallback).trim();
    if (value) config[field.pathKey] = value;
    return config;
  }, { ...(draft.adapterConfig || {}) });
  if (adapterConfig.v2vPath && !adapterConfig.i2vPath) adapterConfig.i2vPath = adapterConfig.v2vPath;
  delete adapterConfig.v2vPath;
  if (category === "text" && draft.modelKey) adapterConfig.chatModel = draft.modelKey;
  return {
    name: draft.name,
    modelKey: draft.modelKey,
    adapterKey,
    provider: adapter?.provider || draft.provider,
    endpoint: draft.endpoint,
    apiKey: draft.apiKey || undefined,
    category,
    capabilities: category === "text" ? ["text"] : caps,
    adapterConfig,
    pricing: draft.pricing,
    enabled: draft.enabled !== false,
    description: draft.description,
    badge: draft.badge || categoryBadge(category),
    logo: draft.logo || matchModelLogo(draft.name, draft.modelKey, adapter?.provider || draft.provider),
    concurrentLimit: draft.concurrentLimit,
    instanceType: draft.instanceType,
    proxy: draft.proxy,
  };
}

function ModelsPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("全部来源");
  const [category, setCategory] = useState("all");
  const [view, setView] = useState("cards");
  const [editing, setEditing] = useState(undefined);
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const modelsQuery = useQuery({ queryKey: ["admin-models"], queryFn: fetchAdminModels });
  const models = modelsQuery.data || [];
  const modelItems = models.filter((model) => model.category !== "tool");
  const visible = modelItems.filter((model) => matchesProviderFilter(model.provider, provider) && (category === "all" || model.category === category) && `${model.name}${model.description}${model.modelKey}`.toLowerCase().includes(query.toLowerCase()));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-models"] });
    queryClient.invalidateQueries({ queryKey: ["public-models"] });
    queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
  };

  const saveMutation = useMutation({
    mutationFn: (draft) => (draft.id ? updateAdminModel(draft.id, toModelPayload(draft)) : createAdminModel(toModelPayload(draft))),
    onSuccess: () => {
      invalidate();
      setEditing(undefined);
      setNoticeError(false);
      setNotice("模型配置已保存");
    },
    onError: (error) => {
      setNoticeError(true);
      setNotice(errorMessage(error, "保存模型失败"));
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }) => changeAdminModelEnabled(id, enabled),
    onSuccess: invalidate,
    onError: (error) => {
      setNoticeError(true);
      setNotice(errorMessage(error, "更新模型状态失败"));
    },
  });

  const removeMutation = useMutation({
    mutationFn: (model) => deleteAdminModel(model.id),
    onSuccess: () => {
      invalidate();
      setNoticeError(false);
      setNotice("已删除模型");
    },
    onError: (error) => {
      setNoticeError(true);
      setNotice(errorMessage(error, "删除模型失败"));
    },
  });

  return <div className="admin-page">
    <SectionHeading title="模型管理" description="按适配协议接入模型；来源与默认地址由协议带出。" action={<button className="button button--primary" onClick={() => setEditing(null)}><Plus size={16} /> 接入模型</button>} />
    {notice && <div className={`admin-notice${noticeError ? " admin-notice--error" : ""}`}>{noticeError ? null : <Check size={15} />}{notice}<button aria-label="关闭提示" onClick={() => setNotice("")}><X size={14} /></button></div>}
    {modelsQuery.error && <div className="admin-notice admin-notice--error">{errorMessage(modelsQuery.error, "模型列表加载失败")}</div>}
    <div className="model-category-tabs" role="tablist" aria-label="模型类型">{categoryTabs.map((tab) => <button role="tab" aria-selected={category === tab.id} className={category === tab.id ? "active" : ""} key={tab.id} onClick={() => setCategory(tab.id)}>{tab.label}<span>{tab.id === "all" ? modelItems.length : modelItems.filter((item) => item.category === tab.id).length}</span></button>)}</div>
    <div className="model-summary"><span><Server size={17} /><b>{modelItems.filter((item) => item.provider === "ComfyUI").length}</b> ComfyUI</span><span><CloudCog size={17} /><b>{modelItems.filter((item) => item.provider === "RunningHub").length}</b> RunningHub</span><span><Globe size={17} /><b>{modelItems.filter((item) => item.provider === "官方API").length}</b> 官方API</span><span><Cpu size={17} /><b>{modelItems.filter((item) => item.provider === "自定义配置" || item.provider === "手动配置").length}</b> 自定义配置</span><em>已启用 {modelItems.filter((item) => item.enabled !== false).length} / {modelItems.length}</em></div>
    <div className="model-toolbar"><label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型名称或标识" /></label><select aria-label="筛选接入来源" value={provider} onChange={(event) => setProvider(event.target.value)}>{providerOptions.map((item) => <option key={item}>{item}</option>)}</select><div className="view-switch" role="group" aria-label="视图模式"><button className={view === "cards" ? "active" : ""} aria-label="卡片模式" onClick={() => setView("cards")}><Grid2X2 size={15} /></button><button className={view === "list" ? "active" : ""} aria-label="列表模式" onClick={() => setView("list")}><List size={15} /></button></div></div>
    {view === "cards" ? <div className="model-card-grid">{visible.map((model) => <ModelCard key={model.id} model={model} onToggle={(enabled) => toggleMutation.mutate({ id: model.id, enabled })} onEdit={() => setEditing({ ...model, apiKey: "" })} onRemove={() => { if (window.confirm(`确定删除模型“${model.name}”吗？`)) removeMutation.mutate(model); }} />)}</div> : <div className="admin-table-card model-table"><div className="admin-table-scroll"><table><thead><tr><th>模型</th><th>类型</th><th>接入来源</th><th>售价</th><th>成本</th><th>服务状态</th><th>创作端可用</th><th>操作</th></tr></thead><tbody>{visible.map((model) => <tr key={model.id}><td><span className="table-model-logo"><img src={modelLogoSrc(model)} alt="" /></span><span><strong>{model.name}</strong><small>{model.modelKey}</small></span></td><td><span className="category-chip">{categoryLabels[model.category]}</span></td><td>{model.provider}</td><td><PriceCell title="售价" pricing={model.pricing} side="sale" /></td><td><PriceCell title="成本" pricing={model.pricing} side="cost" /></td><td><span className="service-ok"><i />{model.hasApiKey ? "密钥已配置" : "未配置密钥"}</span></td><td><label className="toggle-switch"><input aria-label={`${model.name} 创作端可用`} type="checkbox" checked={model.enabled !== false} onChange={(event) => toggleMutation.mutate({ id: model.id, enabled: event.target.checked })} /><span /></label></td><td><div className="table-actions"><button aria-label={`编辑模型：${model.name}`} onClick={() => setEditing({ ...model, apiKey: "" })}><Pencil size={14} /></button><button className="danger" aria-label={`删除模型：${model.name}`} onClick={() => { if (window.confirm(`确定删除模型“${model.name}”吗？`)) removeMutation.mutate(model); }}><Trash2 size={14} /></button></div></td></tr>)}</tbody></table></div></div>}
    {!visible.length && <div className="admin-empty"><Bot size={22} /><strong>没有匹配的模型</strong><span>接入模型或调整类型、来源、关键词后重试。</span></div>}
    {editing !== undefined && <ModelDialog model={editing} saving={saveMutation.isPending} onClose={() => setEditing(undefined)} onSave={(draft) => saveMutation.mutate(draft)} />}
  </div>;
}

export function AdminConsole() {
  const [active, setActive] = useState("dashboard");
  const current = useMemo(() => adminMenus.find((item) => item.id === active), [active]);
  return <div className="admin-shell"><aside className="admin-sidebar"><header><span><ShieldCheck size={17} /></span><div><strong>管理后台</strong><small>平台运营控制台</small></div></header><nav>{adminMenus.map((item) => { const Icon = item.icon; return <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => setActive(item.id)}><Icon size={17} /><span>{item.label}</span><ChevronRight size={14} /></button>; })}</nav><footer><span><span className="status-dot" /> 服务运行正常</span><small>一期 · 仪表盘 / 用户 / 模型</small></footer></aside><section className="admin-main" aria-label={current?.label}>{active === "dashboard" && <Dashboard />}{active === "users" && <UsersPage />}{active === "models" && <ModelsPage />}</section></div>;
}
